#!/bin/bash
set -e

IMAGE_NAME="recall:dev"

echo "==> Building image..."
podman build -t "$IMAGE_NAME" -f Containerfile . -q

echo "==> Running npm audit..."
echo ""
podman run --rm "$IMAGE_NAME" npm audit 2>&1 || true

echo ""
echo "==> Checking for outdated packages..."
echo ""
podman run --rm "$IMAGE_NAME" npm outdated 2>&1 || true
