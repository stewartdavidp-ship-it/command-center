#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# CC MCP Server — Deploy & Setup
# ═══════════════════════════════════════════════════════════════
#
# Usage:
#   bash deploy.sh              # Build + deploy to TEST (default)
#   bash deploy.sh --prod       # Build + deploy to PRODUCTION (confirmation required)
#   bash deploy.sh --build-only # Just build TypeScript, don't deploy
#
# ── ENVIRONMENTS ────────────────────────────────────────────────
#
# TEST  (cc-mcp-server-test) — Dave validates MCP server code changes.
#       Max 1 instance. Not connected to Claude.ai OAuth.
#       Only Dave's Claude Code connects here during MCP dev.
#
# PROD  (cc-mcp-server) — All users (Claude.ai + Claude Code).
#       Max 3 instances. Connected to Claude.ai OAuth.
#       Promote from test after validation.
#
# Both environments share the same Firebase RTDB (word-boxing).
#
# ── PROMOTION WORKFLOW ──────────────────────────────────────────
#
#   1. bash deploy.sh              # deploy to test
#   2. bash e2e-test.sh            # run tests against test
#   3. Smoke test from Claude Code  # .mcp.json cc-mcp-test entry
#   4. bash deploy.sh --prod       # promote to prod (confirmation prompt)
#   5. bash e2e-test.sh --prod     # optional: verify prod
#
# ── SETUP CHECKLIST (first time or after issues) ──────────────
#
# 1. Deploy:
#      bash deploy.sh              # test
#      bash deploy.sh --prod       # prod
#
# 2. Claude.ai (Chat) — Connect MCP integration (PROD only):
#    a. Go to Claude.ai → Settings → Integrations → Add MCP Server
#    b. Enter URL: https://cc-mcp-server-300155036194.us-central1.run.app/mcp
#    c. It will open a sign-in page — use Google Sign-In or paste your Firebase UID
#    d. After connecting, configure permissions:
#       Claude.ai → Settings → Integrations → cc-mcp-server → Configure
#       Set to "Allow all tools automatically" to avoid per-request permission prompts
#
# 3. Claude Code — .mcp.json in project root:
#    {
#      "mcpServers": {
#        "cc-mcp": {
#          "type": "http",
#          "url": "https://cc-mcp-server-300155036194.us-central1.run.app/mcp",
#          "headers": { "Authorization": "Bearer cc_{uid}_{secret}" }
#        },
#        "cc-mcp-test": {
#          "type": "http",
#          "url": "https://cc-mcp-server-test-300155036194.us-central1.run.app/mcp",
#          "headers": { "Authorization": "Bearer cc_{uid}_{secret}" }
#        }
#      }
#    }
#    Same API key works on both (shared Firebase). Only Dave needs cc-mcp-test.
#
# ── TROUBLESHOOTING ───────────────────────────────────────────
#
# "Connection failed" in Claude.ai after deploy:
#   → OAuth tokens now persist in Firebase RTDB (SHA-256 hashed). Deploys should
#     NOT require reconnection. If it still fails, disconnect and reconnect the
#     MCP integration. The deploy script verifies OAuth metadata automatically.
#
# "auth/invalid-api-key" on Google Sign-In page:
#   → FIREBASE_WEB_API_KEY env var is missing. Re-run deploy.sh.
#
# OAuth metadata shows localhost URLs:
#   → BASE_URL env var is missing. Re-run deploy.sh.
#
# Claude.ai asks permission for every tool call:
#   → Go to Claude.ai → Settings → Integrations → cc-mcp-server → Configure
#     Set to "Allow all tools automatically"
#
# ── GITHUB TOKEN (optional, for auto-delivery) ─────────────────
#
# 4. GitHub Token — for auto-delivery of documents to GitHub repos:
#    a. Create a GitHub PAT with 'repo' scope at https://github.com/settings/tokens
#    b. Store in Secret Manager:
#       echo -n "ghp_XXXXX" | gcloud secrets create GITHUB_TOKEN --data-file=- --project=word-boxing
#    c. Grant access to the Cloud Run service account:
#       gcloud secrets add-iam-policy-binding GITHUB_TOKEN \
#         --member="serviceAccount:300155036194-compute@developer.gserviceaccount.com" \
#         --role="roles/secretmanager.secretAccessor" --project=word-boxing
#
# ── REQUIRED ENV VARS (set below, not secrets) ────────────────
#
#   BASE_URL              — Cloud Run service URL. Without it, OAuth metadata returns
#                           localhost URLs and Claude.ai cannot authenticate.
#   FIREBASE_WEB_API_KEY  — Firebase client-side API key (public, not a secret) for
#                           Google Sign-In on the OAuth authorize page.

set -e

# ── Environment Selection ─────────────────────────────────────
# Default: test. Use --prod for production.
ENV="test"
BUILD_ONLY=false
for arg in "$@"; do
  case $arg in
    --prod) ENV="prod" ;;
    --build-only) BUILD_ONLY=true ;;
  esac
done

REGION="us-central1"
# Pin the project explicitly. Without --project, gcloud deploys to whatever the ambient
# `gcloud config` points at — which silently created a stray cc-mcp-server-test in an
# unrelated project on 2026-08-27, while the OAuth check below curled the hardcoded
# word-boxing URL and reported success for a service the run had not touched.
PROJECT_ID="word-boxing"
PROJECT_NUMBER="300155036194"
FIREBASE_WEB_API_KEY="AIzaSyBQVwn8vOrFTzLlm2MYIPBwgZV2xR9AuhM"

if [ "$ENV" = "prod" ]; then
  SERVICE="cc-mcp-server"
  MAX_INSTANCES=3
else
  SERVICE="cc-mcp-server-test"
  MAX_INSTANCES=1
fi

BASE_URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"

# Build TypeScript first
echo "Building TypeScript..."
npm run build
echo "Build complete."

if [ "$BUILD_ONLY" = true ]; then
  echo "Build-only mode — skipping deploy."
  exit 0
fi

# Production confirmation gate
if [ "$ENV" = "prod" ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║  ⚠️  DEPLOYING TO PRODUCTION                             ║"
  echo "║  Service: cc-mcp-server                                  ║"
  echo "║  This affects ALL users (Claude.ai + Claude Code)        ║"
  echo "║  OAuth tokens persist in Firebase — no reconnect needed  ║"
  echo "╚══════════════════════════════════════════════════════════╝"
  echo ""
  read -p "Type 'yes' to confirm production deploy: " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
fi

echo ""
echo "Deploying to Cloud Run..."
echo "  Environment: $ENV"
echo "  Service:     $SERVICE"
echo "  Project:     $PROJECT_ID"
echo "  Region:      $REGION"
echo "  BASE_URL:    $BASE_URL"
echo "  Max instances: $MAX_INSTANCES"
echo ""

gcloud run deploy "$SERVICE" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,BASE_URL=${BASE_URL},FIREBASE_WEB_API_KEY=${FIREBASE_WEB_API_KEY}" \
  --set-secrets="GITHUB_TOKEN=GITHUB_TOKEN:latest" \
  --memory=256Mi \
  --cpu-throttling \
  --timeout=60 \
  --min-instances=0 \
  --max-instances=$MAX_INSTANCES

echo ""
echo "Deploy complete ($ENV)."
echo ""

# Verify OAuth metadata is correct
echo "Verifying OAuth metadata..."
ISSUER=$(curl -s "${BASE_URL}/.well-known/oauth-authorization-server" | python3 -c "import json,sys; print(json.load(sys.stdin).get('issuer',''))" 2>/dev/null)

if [ "$ISSUER" = "$BASE_URL" ]; then
  echo "  ✅ OAuth issuer is correct: $ISSUER"
else
  echo "  ❌ OAuth issuer is WRONG: $ISSUER (expected $BASE_URL)"
  echo "     Claude.ai will not be able to authenticate!"
  echo "     Check that BASE_URL env var is set correctly."
  exit 1
fi

echo ""
if [ "$ENV" = "prod" ]; then
  echo "Ready. OAuth tokens persist across deploys — users should NOT need to reconnect."
else
  echo "Test deploy ready. Validate with: bash e2e-test.sh"
  echo "When satisfied, promote with: bash deploy.sh --prod"
fi
