#!/bin/bash
set -e

IMAGE_NAME="recall:dev"
VOLUME_NAME="recall-data"

echo "==> Cleaning up old image..."
podman image rm -f "$IMAGE_NAME" 2>/dev/null || true

echo "==> Building new image..."
podman build -t "$IMAGE_NAME" -f Containerfile .

if ! podman volume inspect "$VOLUME_NAME" > /dev/null 2>&1; then
  echo "==> Creating volume $VOLUME_NAME..."
  podman volume create "$VOLUME_NAME"
fi

echo "==> Starting Recall on http://localhost:8788"
echo "    Data persisted in podman volume: $VOLUME_NAME"
podman run --rm -it -p 8788:8788 \
  -v "${VOLUME_NAME}:/app/.wrangler/state" \
  ${RECALL_API_KEY:+-e RECALL_API_KEY="$RECALL_API_KEY"} \
  "$IMAGE_NAME"
