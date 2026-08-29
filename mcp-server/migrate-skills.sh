#!/bin/bash
# Seed Firebase RTDB from the compiled skill snapshot in src/skills.ts.
#
# ⚠️  THIS IS DISASTER RECOVERY ONLY. IT IS NOT THE NORMAL DIRECTION.
#
#     Firebase is the source of truth for skill content. Skills are authored and
#     edited through the `skill` MCP tool (action="create"/"update"). src/skills.ts
#     is a GENERATED snapshot of Firebase, kept only as a cold-cache fallback.
#
#     The normal direction is Firebase → src/skills.ts:
#         bash sync-skills-from-firebase.sh --prod
#
#     This script runs the REVERSE direction (snapshot → Firebase) and is only
#     correct when Firebase has genuinely lost its skills and needs re-seeding.
#
# Why the guards below exist (measured 2026-08-29):
#   This script does not read src/skills.ts. It calls skill(list)/skill(get) on
#   the running server, which serves whatever is in the in-memory cache. The cache
#   is loaded from Firebase at startup, and falls back to the compiled snapshot
#   only when that read returns empty OR THROWS (skill-cache.ts → initSkillCache).
#
#   Those two fallback causes are indistinguishable from the client side, and they
#   want opposite behaviour:
#     - Firebase empty      → seeding is correct.
#     - Firebase read threw → Firebase still holds the live content, and seeding
#                             would overwrite it with a stale snapshot.
#
#   At the time these guards were written, 8 of 33 snapshot skills differed from
#   their Firebase copies and 32 Firebase skills had no snapshot entry at all, so
#   a mistimed run would have regressed real content. Writes also RESET version
#   numbers: writeSkillToCache does existing.version + 1, and in the compiled-
#   fallback state existing.version is 0, so a v7 skill would come back as v1.
#
# Usage:
#   bash migrate-skills.sh --dry               # preview, writes nothing
#   bash migrate-skills.sh --prod --dry        # preview against production
#   bash migrate-skills.sh --confirm-firebase-empty [--prod]
#
# Every mode, --dry included, first refuses outright if the server is serving
# skills from Firebase — in that state there is nothing to re-seed and the
# preview would only be misleading.
#
# The --confirm-firebase-empty flag is required for any write. Before passing it,
# check the Firebase console (or the server's startup logs for
# "[skill-cache] Firebase empty") and confirm the skills node is genuinely empty
# rather than temporarily unreadable.

set -e

# ── Environment Selection ─────────────────────────────────────
ENV="test"
DRY_RUN=false
CONFIRMED_EMPTY=false
for arg in "$@"; do
  case $arg in
    --prod) ENV="prod" ;;
    --dry) DRY_RUN=true ;;
    --confirm-firebase-empty) CONFIRMED_EMPTY=true ;;
  esac
done

if [ "$ENV" = "prod" ]; then
  URL="https://cc-mcp-server-300155036194.us-central1.run.app/mcp"
else
  URL="https://cc-mcp-server-test-300155036194.us-central1.run.app/mcp"
fi
AUTH="Authorization: Bearer cc_oUt4ba0dYVRBfPREqoJ1yIsJKjr1_wxityxnkh8pqw1vu7ztmp"

echo "═══════════════════════════════════════════════════════════"
echo "  CC Skill Re-Seed — Compiled Snapshot → Firebase"
echo "  Environment: $ENV"
echo "  Dry run: $DRY_RUN"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Helper: call MCP tool
call_tool() {
  local tool="$1"
  local args="$2"
  curl -s -X POST "$URL" \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args}}" \
    2>/dev/null | grep "^data:" | sed 's/^data: //' || true
}

get_text() {
  echo "$1" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    print(d.get('result',{}).get('content',[{}])[0].get('text',''))
except Exception:
    print('')
"
}

is_error() {
  echo "$1" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    print('true' if d.get('result',{}).get('isError') else 'false')
except Exception:
    print('true')
"
}

# ── Step 1: Read server state ─────────────────────────────────
echo "── Step 1: Reading current skills from server ──"
RAW=$(call_tool "skill" '{"action":"list"}')
TEXT=$(get_text "$RAW")

if [ -z "$TEXT" ]; then
  echo "  ❌ Empty response from server. Aborting."
  exit 1
fi

CURRENT_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('count', 0))")
SOURCE=$(echo "$TEXT" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('source', 'unknown'))")
echo "  Current skills: $CURRENT_COUNT (cache source: $SOURCE)"
echo ""

# ── Step 2: Safety gate ───────────────────────────────────────
echo "── Step 2: Safety gate ──"

if [ "$SOURCE" = "firebase" ]; then
  echo ""
  echo "  ⛔ REFUSING TO RUN — the cache is serving from Firebase."
  echo ""
  echo "  Firebase already holds $CURRENT_COUNT skills and is the source of truth."
  echo "  Running this script now would read those skills back through the server"
  echo "  and rewrite them, bumping every version number and changing nothing —"
  echo "  or, if the snapshot were used instead, regressing live content."
  echo ""
  echo "  You almost certainly want the other direction:"
  echo "      bash sync-skills-from-firebase.sh --$ENV"
  echo ""
  exit 2
fi

if [ "$SOURCE" != "compiled" ]; then
  echo "  ⛔ Unexpected cache source '$SOURCE' — refusing to run."
  echo "     Expected 'compiled' (Firebase unreadable/empty) or 'firebase' (healthy)."
  exit 2
fi

echo "  Cache source is 'compiled' — the server could not load skills from Firebase."
echo ""
echo "  ⚠️  This has two possible causes, and they are indistinguishable from here:"
echo "        (a) Firebase is genuinely empty      → seeding is correct"
echo "        (b) the Firebase read threw an error → Firebase still holds live"
echo "            content, and seeding would OVERWRITE it with a stale snapshot"
echo "            and reset every version number to 1"
echo ""

if [ "$DRY_RUN" = false ] && [ "$CONFIRMED_EMPTY" = false ]; then
  echo "  ⛔ REFUSING TO WRITE without --confirm-firebase-empty."
  echo ""
  echo "  Verify the skills node is actually empty (Firebase console, or the"
  echo "  server startup log line '[skill-cache] Firebase empty'), then re-run:"
  echo "      bash migrate-skills.sh $([ "$ENV" = "prod" ] && echo '--prod ')--confirm-firebase-empty"
  echo ""
  echo "  To preview without writing:  bash migrate-skills.sh $([ "$ENV" = "prod" ] && echo '--prod ')--dry"
  exit 2
fi

if [ "$DRY_RUN" = false ]; then
  echo "  ✅ --confirm-firebase-empty supplied — proceeding with seed."
else
  echo "  (dry run — nothing will be written)"
fi
echo ""

# ── Step 3: Seed ──────────────────────────────────────────────
SKILL_NAMES=$(echo "$TEXT" | python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
for s in d.get('skills', []):
    print(s['name'])
")

MIGRATED=0
FAILED=0
SKIPPED=0

echo "── Step 3: Seeding skills to Firebase ──"

echo "$SKILL_NAMES" | while IFS= read -r SKILL_NAME; do
  [ -z "$SKILL_NAME" ] && continue
  if [ "$DRY_RUN" = true ]; then
    echo "  [dry] Would seed: $SKILL_NAME"
    continue
  fi

  RAW=$(call_tool "skill" "{\"action\":\"get\",\"skillName\":\"$SKILL_NAME\"}")
  CONTENT=$(get_text "$RAW")

  if [ -z "$CONTENT" ]; then
    echo "  ❌ $SKILL_NAME — empty content, skipping"
    continue
  fi

  SKILL_DESC=$(echo "$TEXT" | python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
for s in d.get('skills', []):
    if s['name'] == '$SKILL_NAME':
        print(s.get('description', '')); break
")
  SKILL_CAT=$(echo "$TEXT" | python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
for s in d.get('skills', []):
    if s['name'] == '$SKILL_NAME':
        print(s.get('category', 'custom')); break
")

  ESCAPED_CONTENT=$(python3 -c "
import json,sys
print(json.dumps(sys.stdin.read()))
" <<< "$CONTENT")

  ESCAPED_DESC=$(python3 -c "
import json,sys
print(json.dumps(sys.stdin.read().strip()))
" <<< "$SKILL_DESC")

  UPDATE_ARGS="{\"action\":\"update\",\"skillName\":\"$SKILL_NAME\",\"description\":$ESCAPED_DESC,\"content\":$ESCAPED_CONTENT,\"category\":\"$SKILL_CAT\",\"initiator\":\"claude-code\"}"

  RAW=$(call_tool "skill" "$UPDATE_ARGS")
  ERR=$(is_error "$RAW")

  if [ "$ERR" = "true" ]; then
    echo "  ❌ $SKILL_NAME — update failed"
  else
    VERSION=$(get_text "$RAW" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('version','?'))" 2>/dev/null || echo '?')
    echo "  ✅ $SKILL_NAME (v$VERSION, $SKILL_CAT)"
  fi
done

echo ""
echo "═══════════════════════════════════════════════════════════"
if [ "$DRY_RUN" = true ]; then
  echo "  Dry run complete — $CURRENT_COUNT skills would be seeded"
else
  echo "  Seed complete"
fi
echo "═══════════════════════════════════════════════════════════"

# ── Step 4: Verify ────────────────────────────────────────────
if [ "$DRY_RUN" = false ]; then
  echo ""
  echo "── Step 4: Verification ──"
  RAW=$(call_tool "skill" '{"action":"list"}')
  TEXT=$(get_text "$RAW")
  FINAL_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('count', 0))")
  FINAL_SOURCE=$(echo "$TEXT" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('source', 'unknown'))")
  echo "  Final skills: $FINAL_COUNT (source: $FINAL_SOURCE)"

  if [ "$FINAL_COUNT" -eq "$CURRENT_COUNT" ]; then
    echo "  ✅ Skill count matches — seed verified"
  else
    echo "  ⚠️  Skill count mismatch: expected $CURRENT_COUNT, got $FINAL_COUNT"
  fi
  echo ""
  echo "  Next: re-sync the compiled snapshot so it matches Firebase again:"
  echo "      bash sync-skills-from-firebase.sh --$ENV"
fi
