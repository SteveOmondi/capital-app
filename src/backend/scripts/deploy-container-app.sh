#!/usr/bin/env bash
# Script to provision Azure Container App (ACA) pointing to Docker Hub image and existing DB/Redis.

RESOURCE_GROUP=${RESOURCE_GROUP:-"rg-capitalfm-prod"}
LOCATION=${LOCATION:-"eastus"}
ACA_ENV_NAME=${ACA_ENV_NAME:-"env-capitalfm-prod"}
APP_NAME=${APP_NAME:-"ca-capitalfm-backend-api"}
DOCKER_IMAGE=${DOCKER_IMAGE:-"docker.io/stephenomondi/capitalfm-backend:latest"}

echo "🚀 Starting Azure Container App Deployment for Capital FM Backend"

# 1. Ensure Resource Group exists
az group create --name $RESOURCE_GROUP --location $LOCATION

# 2. Register Azure Container Apps extension
az extension add --name containerapp --upgrade

# 3. Create ACA Managed Environment if not exists
az containerapp env create \
  --name $ACA_ENV_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION

# 4. Create or Update Azure Container App
az containerapp create \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --environment $ACA_ENV_NAME \
  --image $DOCKER_IMAGE \
  --target-port 3000 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 5 \
  --env-vars \
    NODE_ENV=production \
    PORT=3000 \
    LOG_LEVEL=info \
    DATABASE_URL="postgresql://user:password@your-postgres-host:5432/capitalfm_db?schema=public" \
    REDIS_HOST="your-redis-host" \
    REDIS_PORT=6379 \
    WP_WEBHOOK_SECRET="capital_fm_secret_webhook_key_2026"

echo "✅ Azure Container App deployed successfully!"
echo "🌐 URL: https://$(az containerapp show --name $APP_NAME --resource-group $RESOURCE_GROUP --query properties.configuration.ingress.fqdn -o tsv)"
