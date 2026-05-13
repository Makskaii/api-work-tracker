#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

COMPOSE_FILE="${PROJECT_ROOT}/docker/production/docker-compose.yml"
PROJECT_NAME="production"
NETWORK_NAME="${PROJECT_NAME}_default"

APP_IMAGE="work-tracker-api"
CANDIDATE_CONTAINER="work-tracker-api-candidate"

APP_PORT="3001"
CANDIDATE_PORT="3002"

HEALTH_URL="http://127.0.0.1:${CANDIDATE_PORT}/health"
ENV_FILE="${PROJECT_ROOT}/.env"

cleanup_candidate() {
  docker rm -f "${CANDIDATE_CONTAINER}" 2>/dev/null || true
}

wait_for_candidate_health() {
  local attempts=20
  local sleep_seconds=3

  for ((i=1; i<=attempts; i++)); do
    if curl -fsS "${HEALTH_URL}" >/dev/null; then
      echo "Candidate is healthy."
      return 0
    fi

    echo "Healthcheck attempt ${i}/${attempts} failed. Retrying in ${sleep_seconds}s..."
    sleep "${sleep_seconds}"
  done

  return 1
}

trap cleanup_candidate EXIT

echo "Pulling latest code..."
cd "${PROJECT_ROOT}"
git pull

GIT_SHA=$(git rev-parse --short HEAD)
NEW_IMAGE_TAG="${APP_IMAGE}:${GIT_SHA}"

echo "Building new image: ${NEW_IMAGE_TAG}"
docker build \
  -f "${PROJECT_ROOT}/docker/production/Dockerfile" \
  -t "${NEW_IMAGE_TAG}" \
  "${PROJECT_ROOT}"

echo "Ensuring redis is up..."
docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" up -d redis

echo "Removing old candidate container if exists..."
cleanup_candidate

echo "Running database migrations..."
docker run --rm \
  --env-file "${ENV_FILE}" \
  --add-host host.docker.internal:host-gateway \
  --network "${NETWORK_NAME}" \
  "${NEW_IMAGE_TAG}" \
  npm run migration:run:prod

echo "Starting candidate container on port ${CANDIDATE_PORT}..."
docker run -d \
  --name "${CANDIDATE_CONTAINER}" \
  --env-file "${ENV_FILE}" \
  --add-host host.docker.internal:host-gateway \
  --network "${NETWORK_NAME}" \
  -p "${CANDIDATE_PORT}:${APP_PORT}" \
  "${NEW_IMAGE_TAG}"

echo "Waiting for candidate to become healthy..."
if ! wait_for_candidate_health; then
  echo "Candidate failed healthcheck. Current production container remains untouched."
  echo "Candidate logs:"
  docker logs "${CANDIDATE_CONTAINER}" --tail=200 || true
  exit 1
fi

echo "Tagging healthy image as latest..."
docker tag "${NEW_IMAGE_TAG}" "${APP_IMAGE}:latest"

echo "Replacing production backend with healthy image..."
docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" up -d --no-deps --force-recreate backend

echo "Stopping and removing candidate..."
cleanup_candidate
trap - EXIT

echo "Cleaning dangling images..."
docker image prune -f >/dev/null 2>&1 || true

echo "Deploy completed successfully."
