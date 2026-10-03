#!/bin/bash
set -eo pipefail

# =========================================================================
# Capital FM Production Deployment & Rollback Script
# Executed on target server under user azdevops at /opt/apps/capital-app
# =========================================================================

APP_DIR="/opt/apps/capital-app"
DOCKER_IMAGE="${DOCKER_IMAGE:-jimane254/capital-app}"
DOCKER_IMAGE_TAG="${DOCKER_IMAGE_TAG:-latest}"
DEPLOY_CONTAINERIZED_DB="${DEPLOY_CONTAINERIZED_DB:-true}"
DEPLOY_CONTAINERIZED_REDIS="${DEPLOY_CONTAINERIZED_REDIS:-true}"
CLEAR_CACHE_ON_DEPLOY="${CLEAR_CACHE_ON_DEPLOY:-false}"

echo "================================================================="
echo " Starting Capital FM Production Deployment"
echo " Target Directory: $APP_DIR"
echo " Image: $DOCKER_IMAGE:$DOCKER_IMAGE_TAG"
echo " Containerized DB: $DEPLOY_CONTAINERIZED_DB | Containerized Redis: $DEPLOY_CONTAINERIZED_REDIS"
echo " Clear Cache On Deploy: $CLEAR_CACHE_ON_DEPLOY"
echo "================================================================="

# 1. Ensure required infrastructure directory structure exists
mkdir -p "$APP_DIR/data/postgres" "$APP_DIR/data/redis" "$APP_DIR/nginx"
if [ -d "$APP_DIR/nginx/nginx.conf" ]; then
    echo "Cleaning up erroneous directory mount at $APP_DIR/nginx/nginx.conf..."
    mv "$APP_DIR/nginx" "$APP_DIR/nginx_bak_$(date +%s)" 2>/dev/null || true
    mkdir -p "$APP_DIR/nginx"
fi
cd "$APP_DIR"

# 2. Record previous stable image tag for potential rollback
PREVIOUS_TAG=""
if [ -f "$APP_DIR/.last_stable_tag" ]; then
    PREVIOUS_TAG=$(cat "$APP_DIR/.last_stable_tag")
    echo "Current stable tag on record: $PREVIOUS_TAG"
fi

# 3. Pull target Docker image
echo "Pulling latest image: $DOCKER_IMAGE:$DOCKER_IMAGE_TAG..."
docker pull "$DOCKER_IMAGE:$DOCKER_IMAGE_TAG"

# 4. Build Docker Compose Profile flags based on DB/Redis settings
PROFILES=""
if [ "$DEPLOY_CONTAINERIZED_DB" = "true" ]; then
    PROFILES="$PROFILES --profile container-db"
fi
if [ "$DEPLOY_CONTAINERIZED_REDIS" = "true" ]; then
    PROFILES="$PROFILES --profile container-redis"
fi

# Export image tag for docker-compose.prod.yml
export DOCKER_IMAGE
export DOCKER_IMAGE_TAG

echo "Launching 3 backend API instances + NGINX round-robin load balancer via Docker Compose..."
docker compose $PROFILES -f "$APP_DIR/docker-compose.prod.yml" up -d --remove-orphans

# Ensure PostgreSQL container is ready and user authentication credentials match .env
if [ "$DEPLOY_CONTAINERIZED_DB" = "true" ]; then
    source "$APP_DIR/.env" 2>/dev/null || true
    echo "Waiting for PostgreSQL database container to be ready..."
    MAX_DB_RETRIES=15
    DB_RETRY=0
    until docker exec capital_fm_postgres pg_isready -h 127.0.0.1 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-capitalfm_db}" 2>/dev/null || [ $DB_RETRY -eq $MAX_DB_RETRIES ]; do
        DB_RETRY=$((DB_RETRY + 1))
        echo "Waiting for PostgreSQL database connection... ($DB_RETRY/$MAX_DB_RETRIES)"
        sleep 2
    done

    if [ -n "$POSTGRES_USER" ] && [ -n "$POSTGRES_PASSWORD" ]; then
        echo "Synchronizing PostgreSQL user password inside database container..."
        docker exec -u postgres capital_fm_postgres psql -h /var/run/postgresql -U postgres -d "${POSTGRES_DB:-capitalfm_db}" -c "ALTER USER \"$POSTGRES_USER\" WITH PASSWORD '$POSTGRES_PASSWORD';" 2>/dev/null || docker exec -u postgres capital_fm_postgres psql -U postgres -d "${POSTGRES_DB:-capitalfm_db}" -c "ALTER USER \"$POSTGRES_USER\" WITH PASSWORD '$POSTGRES_PASSWORD';" 2>/dev/null || true
    fi
fi

# 5. Run Prisma Database Migrations / Schema Sync inside container
echo "Executing Prisma database schema synchronization..."
if docker compose -f "$APP_DIR/docker-compose.prod.yml" exec -T backend_1 npx prisma migrate deploy 2>/dev/null; then
    echo "Prisma migrations applied successfully."
else
    echo "Prisma migrate deploy bypassed/failed. Executing schema sync (prisma db push)..."
    if ! docker compose -f "$APP_DIR/docker-compose.prod.yml" exec -T backend_1 npx prisma db push --skip-generate; then
        echo "ERROR: Prisma schema synchronization failed!"
        TRIGGER_ROLLBACK=true
    else
        echo "Prisma schema successfully synchronized via db push."
    fi
fi

# 5.5. Purge PostgreSQL & Redis cache if CLEAR_CACHE_ON_DEPLOY flag is enabled
if [ "$CLEAR_CACHE_ON_DEPLOY" = "true" ] && [ "$TRIGGER_ROLLBACK" != "true" ]; then
    echo "================================================================="
    echo " CLEAR_CACHE_ON_DEPLOY is true. Purging PostgreSQL and Redis cache..."
    echo "================================================================="
    if docker compose -f "$APP_DIR/docker-compose.prod.yml" exec -T backend_1 npm run cache:clear; then
        echo "Cache clear completed successfully."
    else
        echo "WARNING: Cache clear command returned warnings or non-zero exit code."
    fi
fi

# 6. Perform Healthcheck Polling
if [ "$TRIGGER_ROLLBACK" != "true" ]; then
    echo "Initiating healthcheck verification..."
    HEALTHCHECK_PASSED=false
    MAX_RETRIES=12
    RETRY_COUNT=0

    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo "Healthcheck attempt $RETRY_COUNT/$MAX_RETRIES..."
        
        HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/stream/config || echo "000")
        
        if [ "$HTTP_STATUS" -eq 200 ]; then
            HEALTHCHECK_PASSED=true
            echo "SUCCESS: Healthcheck passed! HTTP status 200 received from /api/v1/stream/config"
            break
        else
            echo "Waiting for service initialization... (HTTP status: $HTTP_STATUS)"
            sleep 5
        fi
    done

    if [ "$HEALTHCHECK_PASSED" != "true" ]; then
        echo "ERROR: Healthcheck failed after $MAX_RETRIES retries!"
        TRIGGER_ROLLBACK=true
    fi
fi

# 7. Automated Rollback Handler
if [ "$TRIGGER_ROLLBACK" = "true" ]; then
    echo "================================================="
    echo " CRITICAL FAILURE: Initiating Deployment Rollback"
    echo "================================================="
    
    if [ -n "$PREVIOUS_TAG" ] && [ "$PREVIOUS_TAG" != "$DOCKER_IMAGE_TAG" ]; then
        echo "Rolling back to previous stable image tag: $PREVIOUS_TAG..."
        export DOCKER_IMAGE_TAG="$PREVIOUS_TAG"
        docker compose $PROFILES -f "$APP_DIR/docker-compose.prod.yml" up -d --remove-orphans
        echo "Rollback to tag $PREVIOUS_TAG complete."
    else
        echo "WARNING: No prior stable image tag available to roll back to."
    fi

    exit 1
fi

# 8. Mark deployment successful and update last stable tag record
echo "$DOCKER_IMAGE_TAG" > "$APP_DIR/.last_stable_tag"
echo "================================================================="
echo " Deployment Successfully Completed & Verified!"
echo " Active Stable Tag: $DOCKER_IMAGE_TAG"
echo "================================================================="
