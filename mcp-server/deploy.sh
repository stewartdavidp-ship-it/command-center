#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# CC MCP Server — Deploy & Setup
# ═══════════════════════════════════════════════════════════════
#
# Usage:
#   bash deploy.sh              # Build + deploy
#   bash deploy.sh --build-only # Just build TypeScript, don't deploy
#
# ── SETUP CHECKLIST (first time or after issues) ──────────────
#
# 1. Deploy:
#      bash deploy.sh
#
# 2. Claude.ai (Chat) — Connect MCP integration:
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
#          "headers": {
#            "Authorization": "Bearer cc_{uid}_{secret}"
#          }
#        }
#      }
#    }
#    The API key is generated in CC app and stored as SHA-256 hash in Firebase.
#
# ── TROUBLESHOOTING ───────────────────────────────────────────
#
# "Connection failed" in Claude.ai after deploy:
#   → Disconnect and reconnect the MCP integration (OAuth tokens are in-memory,
#     lost on redeploy). The deploy script verifies OAuth metadata automatically.
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

SERVICE="cc-mcp-server"
REGION="us-central1"
PROJECT_NUMBER="300155036194"
BASE_URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
FIREBASE_WEB_API_KEY="AIzaSyBQVwn8vOrFTzLlm2MYIPBwgZV2xR9AuhM"

# Build TypeScript first
echo "Building TypeScript..."
npm run build
echo "Build complete."

if [ "$1" = "--build-only" ]; then
  echo "Build-only mode — skipping deploy."
  exit 0
fi

echo ""
echo "Deploying to Cloud Run..."
echo "  Service:  $SERVICE"
echo "  Region:   $REGION"
echo "  BASE_URL: $BASE_URL"
echo ""

gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,BASE_URL=${BASE_URL},FIREBASE_WEB_API_KEY=${FIREBASE_WEB_API_KEY}" \
  --set-secrets="GITHUB_TOKEN=GITHUB_TOKEN:latest" \
  --memory=256Mi \
  --timeout=60 \
  --min-instances=0 \
  --max-instances=3

echo ""
echo "Deploy complete."
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
echo "Ready. If Claude.ai shows connection errors, disconnect and reconnect the MCP integration."
