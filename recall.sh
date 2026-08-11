#!/bin/bash
# recall — CLI to add bookmarks to Recall
#
# Usage:
#   recall <url> [tag1 tag2 ...]
#   recall --secret <url> [tag1 tag2 ...]
#   recall search <query>
#
# Setup:
#   export RECALL_URL="https://recall-xxx.pages.dev"  # or http://localhost:8788
#   export RECALL_API_KEY="<your-api-key>"             # required
#
# Add to ~/.bashrc:
#   source ~/workarea/recall-project/recall.sh

RECALL_URL="${RECALL_URL:-http://localhost:8788}"
RECALL_API_KEY="${RECALL_API_KEY:-}"

recall() {
  if [ -z "$1" ]; then
    echo "Usage: recall <url> [tag1 tag2 ...]"
    echo "       recall --secret <url> [tag1 tag2 ...]"
    echo "       recall search <query>"
    return 1
  fi

  if [ "$1" = "search" ]; then
    shift
    local query="$*"
    curl -s -H "X-API-Key: ${RECALL_API_KEY}" \
      "${RECALL_URL}/api/search?q=$(printf '%s' "$query" | jq -sRr @uri)" \
      | jq -r '.results[] | "\(.title // .url)\n  \(.url)\n  tags: \(.tags)\(.secret // 0 | if . == 1 then "  [secret]" else "" end)\n"'
    return
  fi

  local secret=false
  if [ "$1" = "--secret" ]; then
    secret=true
    shift
  fi

  local url="$1"
  shift
  local tags=""
  if [ $# -gt 0 ]; then
    tags=$(IFS=,; echo "$*")
  fi

  local result
  result=$(curl -s -X POST "${RECALL_URL}/api/bookmarks" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: ${RECALL_API_KEY}" \
    -d "{\"url\":\"${url}\",\"tags\":\"${tags}\",\"secret\":${secret}}")

  local title
  title=$(echo "$result" | jq -r '.title // .error // "unknown"')

  if echo "$result" | jq -e '.id' > /dev/null 2>&1; then
    echo "Saved: ${title}"
    echo "  ${url}"
    [ -n "$tags" ] && echo "  tags: ${tags}"
    [ "$secret" = "true" ] && echo "  [secret]"
  else
    echo "Error: ${title}"
  fi
}
