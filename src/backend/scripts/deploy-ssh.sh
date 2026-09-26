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

echo "================================================================="
echo " Starting Capital FM Production Deployment"
echo " Target Directory: $APP_DIR"
echo " Image: $DOCKER_IMAGE:$DOCKER_IMAGE_TAG"
echo " Containerized DB: $DEPLOY_CONTAINERIZED_DB | Containerized Redis: $DEPLOY_CONTAINERIZED_REDIS"
echo "================================================================="

# 1. Ensure required infrastructure directory structure exists
mkdir -p "$APP_DIR/data/postgres" "$APP_DIR/data/redis" "$APP_DIR/nginx"
if [ -d "$APP_DIR/nginx/nginx.conf" ]; then
    echo "Cleaning up erroneous directory mount at $APP_DIR/nginx/nginx.conf..."
    sudo rm -rf "$APP_DIR/nginx/nginx.conf" 2>/dev/null || rm -rf "$APP_DIR/nginx/nginx.conf"
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
