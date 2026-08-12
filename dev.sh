#!/bin/bash
set -e

IMAGE_NAME="recall:dev"
VOLUME_NAME="recall-data"
ENV_FILE="$(dirname "$0")/.env"

# Generate API key if not set and no .env file exists
if [ -z "$RECALL_API_KEY" ]; then
  if [ -f "$ENV_FILE" ]; then
    source "$ENV_FILE"
  else
    RECALL_API_KEY=$(uuidgen)
    echo "RECALL_API_KEY=$RECALL_API_KEY" > "$ENV_FILE"
    echo "==> Generated new API key and saved to .env"
  fi
fi

echo "==> Cleaning up old image..."
podman image rm -f "$IMAGE_NAME" 2>/dev/null || true

echo "==> Building new image..."
podman build -t "$IMAGE_NAME" -f Containerfile .

if ! podman volume inspect "$VOLUME_NAME" > /dev/null 2>&1; then
  echo "==> Creating volume $VOLUME_NAME..."
  podman volume create "$VOLUME_NAME"
fi

echo ""
echo "==> Starting Recall on http://localhost:8788"
echo "    Data persisted in podman volume: $VOLUME_NAME"
echo ""
echo "    API Key: $RECALL_API_KEY"
echo "    (use this in browser Settings and CLI)"
echo ""

podman run --rm -it -p 8788:8788 \
  -v "${VOLUME_NAME}:/app/.wrangler/state" \
  -e RECALL_API_KEY="$RECALL_API_KEY" \
  "$IMAGE_NAME"
