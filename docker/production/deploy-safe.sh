#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker/production/docker-compose.yml"
PROJECT_NAME="production"

APP_IMAGE="work-tracker-api"
APP_CONTAINER="work-tracker-api"
CANDIDATE_CONTAINER="work-tracker-api-candidate"

APP_PORT="3001"
CANDIDATE_PORT="3002"

HEALTH_URL="http://127.0.0.1:${CANDIDATE_PORT}/health"
ENV_FILE=".env"

echo "Pulling latest code..."
git pull

GIT_SHA=$(git rev-parse --short HEAD)
NEW_IMAGE_TAG="${APP_IMAGE}:${GIT_SHA}"

echo "Building new image: ${NEW_IMAGE_TAG}"
docker build \
  -f docker/production/Dockerfile \
  -t "${NEW_IMAGE_TAG}" \
  ../..

echo "Ensuring redis is up..."
docker compose -f "${COMPOSE_FILE}" up -d redis

echo "Removing old candidate container if exists..."
docker rm -f "${CANDIDATE_CONTAINER}" 2>/dev/null || true

echo "Starting candidate container on port ${CANDIDATE_PORT}..."
docker run -d \
  --name "${CANDIDATE_CONTAINER}" \
  --env-file "${ENV_FILE}" \
  --restart unless-stopped \
  --add-host host.docker.internal:host-gateway \
  --network "${PROJECT_NAME}_default" \
  -p "${CANDIDATE_PORT}:${APP_PORT}" \
  "${NEW_IMAGE_TAG}"

echo "Waiting for candidate to become healthy..."
ATTEMPTS=20
SLEEP_SECONDS=3

for ((i=1; i<=ATTEMPTS; i++)); do
  if curl -fsS "${HEALTH_URL}" >/dev/null; then
    echo "Candidate is healthy."
    HEALTH_OK=1
    break
  fi

  echo "Healthcheck attempt ${i}/${ATTEMPTS} failed. Retrying in ${SLEEP_SECONDS}s..."
  sleep "${SLEEP_SECONDS}"
done

if [[ "${HEALTH_OK:-0}" != "1" ]]; then
  echo "Candidate failed healthcheck. Current production container remains untouched."
  echo "Candidate logs:"
  docker logs "${CANDIDATE_CONTAINER}" --tail=200 || true
  docker rm -f "${CANDIDATE_CONTAINER}" 2>/dev/null || true
  exit 1
fi

echo "Tagging healthy image as latest..."
docker tag "${NEW_IMAGE_TAG}" "${APP_IMAGE}:latest"

echo "Replacing production backend with healthy image..."
docker compose -f "${COMPOSE_FILE}" up -d --no-deps backend

echo "Stopping and removing candidate..."
docker rm -f "${CANDIDATE_CONTAINER}" 2>/dev/null || true

echo "Cleaning dangling images..."
docker image prune -f >/dev/null 2>&1 || true

echo "Deploy completed successfully."