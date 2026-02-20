#!/bin/bash
# E2E Test Suite for CC MCP Server (10 tools)
# Tests all actions, cross-tool tracking, state machine, and edge cases.

set -e

URL="https://cc-mcp-server-300155036194.us-central1.run.app/mcp"
AUTH="Authorization: Bearer cc_oUt4ba0dYVRBfPREqoJ1yIsJKjr1_wxityxnkh8pqw1vu7ztmp"
PASS=0
FAIL=0
TOTAL=0

# Helper: call MCP tool and return the text content from result
# Retries up to 3 times on empty responses (Cloud Run cold starts)
call_tool() {
  local tool="$1"
  local args="$2"
  local retries=3
  local result=""
  for i in $(seq 1 $retries); do
    result=$(curl -s -X POST "$URL" \
      -H "$AUTH" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args}}" \
      2>/dev/null | grep "^data:" | sed 's/^data: //' || true)
    if [ -n "$result" ]; then
      echo "$result"
      return 0
    fi
    if [ $i -lt $retries ]; then
      sleep 2
    fi
  done
  # Return empty JSON object as fallback to prevent parse crashes
  echo '{"result":{"content":[{"type":"text","text":""}]}}'
}

# Helper: extract text content from MCP response
get_text() {
  echo "$1" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    print(d.get('result',{}).get('content',[{}])[0].get('text',''))
except:
    print('')
"
}

# Helper: check if response has isError
is_error() {
  echo "$1" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    print('true' if d.get('result',{}).get('isError') else 'false')
except:
    print('true')
"
}

# Helper: extract field from JSON text
jq_field() {
  echo "$1" | python3 -c "
import json,sys
try:
    d=json.loads(sys.stdin.read())
    print(d$2)
except:
    print('')
"
}

# Test assertion
assert() {
  TOTAL=$((TOTAL + 1))
  local test_name="$1"
  local expected="$2"
  local actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ✅ $test_name"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $test_name (expected: $expected, got: $actual)"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  TOTAL=$((TOTAL + 1))
  local test_name="$1"
  local needle="$2"
  local haystack="$3"
  if echo "$haystack" | grep -qF -- "$needle"; then
    echo "  ✅ $test_name"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $test_name (expected to contain: $needle)"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  TOTAL=$((TOTAL + 1))
  local test_name="$1"
  local needle="$2"
  local haystack="$3"
  if echo "$haystack" | grep -qF -- "$needle"; then
    echo "  ❌ $test_name (should NOT contain: $needle)"
    FAIL=$((FAIL + 1))
  else
    echo "  ✅ $test_name"
    PASS=$((PASS + 1))
  fi
}

assert_not_empty() {
  TOTAL=$((TOTAL + 1))
  local test_name="$1"
  local val="$2"
  if [ -n "$val" ] && [ "$val" != "None" ] && [ "$val" != "null" ] && [ "$val" != "" ]; then
    echo "  ✅ $test_name"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $test_name (was empty/null)"
    FAIL=$((FAIL + 1))
  fi
}

echo "═══════════════════════════════════════════════════════════"
echo "  CC MCP Server — End-to-End Test Suite"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ═══════════════════════════════════════════════════════════════
echo "── Phase 1: App Discovery ────────────────────────────────"
# ═══════════════════════════════════════════════════════════════

# Test 1: app list
RAW=$(call_tool "app" '{"action":"list"}')
TEXT=$(get_text "$RAW")
APP_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('apps',[])))")
assert "app(list) returns apps" "true" "$([ "$APP_COUNT" -gt 0 ] && echo true || echo false)"

# Test 2: app get (exact ID)
RAW=$(call_tool "app" '{"action":"get","appId":"command-center"}')
TEXT=$(get_text "$RAW")
APP_NAME=$(jq_field "$TEXT" "['name']")
assert "app(get) exact match" "Command Center" "$APP_NAME"

# Test 3: app get (fuzzy name)
RAW=$(call_tool "app" '{"action":"get","appId":"word boxing"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "app(get) fuzzy match not error" "false" "$ERR"

# Test 4: app get (nonexistent)
RAW=$(call_tool "app" '{"action":"get","appId":"nonexistent-app-xyz"}')
ERR=$(is_error "$RAW")
assert "app(get) nonexistent returns isError" "true" "$ERR"

# Test 5: app get (missing appId)
RAW=$(call_tool "app" '{"action":"get"}')
ERR=$(is_error "$RAW")
assert "app(get) missing appId returns isError" "true" "$ERR"

echo ""

# ═══════════════════════════════════════════════════════════════
echo "── Phase 1b: App Update ────────────────────────────────"
# ═══════════════════════════════════════════════════════════════

# Test: app update description
RAW=$(call_tool "app" '{"action":"update","appId":"command-center","description":"E2E: AI ideation rigor platform"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "app(update) not error" "false" "$ERR"
assert_contains "app(update) description set" "E2E: AI ideation rigor platform" "$TEXT"

# Test: app update lifecycle fields (merge, not clobber)
RAW=$(call_tool "app" '{"action":"update","appId":"command-center","lifecycleFields":"{\"currentMaturity\":\"alpha\",\"targetAudience\":\"developers\"}"}')
TEXT=$(get_text "$RAW")
MATURITY=$(jq_field "$TEXT" "['lifecycle']['currentMaturity']")
TARGET_AUD=$(jq_field "$TEXT" "['lifecycle']['targetAudience']")
assert "app(update) lifecycle currentMaturity" "alpha" "$MATURITY"
assert "app(update) lifecycle targetAudience" "developers" "$TARGET_AUD"

# Test: verify lifecycle merge didn't clobber — update another field and check previous ones survive
RAW=$(call_tool "app" '{"action":"update","appId":"command-center","lifecycleFields":"{\"userGoal\":\"structured ideation\"}"}')
TEXT=$(get_text "$RAW")
MATURITY2=$(jq_field "$TEXT" "['lifecycle']['currentMaturity']")
USER_GOAL=$(jq_field "$TEXT" "['lifecycle']['userGoal']")
assert "app(update) lifecycle merge preserved currentMaturity" "alpha" "$MATURITY2"
assert "app(update) lifecycle userGoal set" "structured ideation" "$USER_GOAL"

# Test: app update nonexistent app
RAW=$(call_tool "app" '{"action":"update","appId":"nonexistent-app-xyz","description":"should fail"}')
ERR=$(is_error "$RAW")
assert "app(update) nonexistent returns isError" "true" "$ERR"

# Test: app update missing appId
RAW=$(call_tool "app" '{"action":"update","description":"should fail"}')
ERR=$(is_error "$RAW")
assert "app(update) missing appId returns isError" "true" "$ERR"

# Test: app update invalid lifecycle JSON
RAW=$(call_tool "app" '{"action":"update","appId":"command-center","lifecycleFields":"not-json"}')
ERR=$(is_error "$RAW")
assert "app(update) invalid lifecycleFields returns isError" "true" "$ERR"

# Test: verify description shows in get
RAW=$(call_tool "app" '{"action":"get","appId":"command-center"}')
TEXT=$(get_text "$RAW")
assert_contains "app(get) shows updated description" "E2E: AI ideation rigor platform" "$TEXT"

# Test: app update repos (set prod and test repos)
RAW=$(call_tool "app" '{"action":"update","appId":"command-center","repos":"{\"prod\":\"e2e-org/e2e-repo\",\"test\":\"e2e-org/e2e-repo-test\"}"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "app(update) repos not error" "false" "$ERR"
assert_contains "app(update) repos prod set" "e2e-org/e2e-repo" "$TEXT"
assert_contains "app(update) repos test set" "e2e-org/e2e-repo-test" "$TEXT"

# Test: app update repos merge (add staging without clobbering prod)
RAW=$(call_tool "app" '{"action":"update","appId":"command-center","repos":"{\"staging\":\"e2e-org/e2e-repo-staging\"}"}')
TEXT=$(get_text "$RAW")
PROD_REPO=$(echo "$TEXT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('repos',{}).get('prod',''))" 2>/dev/null)
STAGING_REPO=$(echo "$TEXT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('repos',{}).get('staging',''))" 2>/dev/null)
assert "app(update) repos merge preserved prod" "e2e-org/e2e-repo" "$PROD_REPO"
assert "app(update) repos merge added staging" "e2e-org/e2e-repo-staging" "$STAGING_REPO"

# Test: app update repos invalid JSON
RAW=$(call_tool "app" '{"action":"update","appId":"command-center","repos":"not-json"}')
ERR=$(is_error "$RAW")
assert "app(update) invalid repos returns isError" "true" "$ERR"

# Test: app update subPath
RAW=$(call_tool "app" '{"action":"update","appId":"command-center","subPath":"e2e-subpath"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "app(update) subPath not error" "false" "$ERR"
assert_contains "app(update) subPath set" "e2e-subpath" "$TEXT"

# Test: app update subPath to empty string (clear)
RAW=$(call_tool "app" '{"action":"update","appId":"command-center","subPath":""}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "app(update) subPath clear not error" "false" "$ERR"

# Test: app update repos and subPath together
RAW=$(call_tool "app" '{"action":"update","appId":"command-center","repos":"{\"prod\":\"e2e-org/final-repo\"}","subPath":"final-sub"}')
TEXT=$(get_text "$RAW")
assert_contains "app(update) combined repos set" "e2e-org/final-repo" "$TEXT"
assert_contains "app(update) combined subPath set" "final-sub" "$TEXT"

# Test: verify repos/subPath show in get
RAW=$(call_tool "app" '{"action":"get","appId":"command-center"}')
TEXT=$(get_text "$RAW")
assert_contains "app(get) shows updated repos" "e2e-org/final-repo" "$TEXT"
assert_contains "app(get) shows updated subPath" "final-sub" "$TEXT"

echo ""

# ═══════════════════════════════════════════════════════════════
echo "── Phase 2: Idea Lifecycle ───────────────────────────────"
# ═══════════════════════════════════════════════════════════════

# Test 6: idea create (unlinked)
RAW=$(call_tool "idea" '{"action":"create","name":"E2E Test Idea - Unlinked","description":"Testing idea creation without app link"}')
TEXT=$(get_text "$RAW")
IDEA1_ID=$(jq_field "$TEXT" "['id']")
IDEA1_STATUS=$(jq_field "$TEXT" "['status']")
assert_not_empty "idea(create) unlinked returns id" "$IDEA1_ID"
assert "idea(create) unlinked status=active" "active" "$IDEA1_STATUS"

# Test 7: idea create (linked to command-center)
RAW=$(call_tool "idea" '{"action":"create","name":"E2E Test Idea - Linked","description":"Testing idea creation with app link","appId":"command-center"}')
TEXT=$(get_text "$RAW")
IDEA2_ID=$(jq_field "$TEXT" "['id']")
IDEA2_SEQ=$(jq_field "$TEXT" "['sequence']")
assert_not_empty "idea(create) linked returns id" "$IDEA2_ID"
assert "idea(create) linked has sequence" "true" "$([ "$IDEA2_SEQ" -gt 0 ] && echo true || echo false)"

# Test 8: idea list (all) — use limit=100 to ensure test data is included
RAW=$(call_tool "idea" '{"action":"list","limit":100}')
TEXT=$(get_text "$RAW")
assert_contains "idea(list) contains test idea" "$IDEA1_ID" "$TEXT"

# Test 9: idea list (filtered by appId) — use limit=100 to ensure test data is included
RAW=$(call_tool "idea" '{"action":"list","appId":"command-center","limit":100}')
TEXT=$(get_text "$RAW")
assert_contains "idea(list, appId) contains linked idea" "$IDEA2_ID" "$TEXT"

# Test 10: idea update
RAW=$(call_tool "idea" "{\"action\":\"update\",\"ideaId\":\"$IDEA1_ID\",\"name\":\"E2E Test Idea - Updated\",\"description\":\"Updated description\"}")
TEXT=$(get_text "$RAW")
UPDATED_NAME=$(jq_field "$TEXT" "['name']")
assert "idea(update) name changed" "E2E Test Idea - Updated" "$UPDATED_NAME"

# Test 11: idea get_active
RAW=$(call_tool "idea" '{"action":"get_active","appId":"command-center"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "idea(get_active) not error" "false" "$ERR"

# Test 12: idea graduate (link unlinked idea to command-center)
RAW=$(call_tool "idea" "{\"action\":\"graduate\",\"ideaId\":\"$IDEA1_ID\",\"appId\":\"command-center\"}")
TEXT=$(get_text "$RAW")
GRAD_STATUS=$(jq_field "$TEXT" "['status']")
GRAD_TYPE=$(jq_field "$TEXT" "['type']")
assert "idea(graduate) status=graduated" "graduated" "$GRAD_STATUS"
assert "idea(graduate) type=addon" "addon" "$GRAD_TYPE"

# Test 13: idea archive
RAW=$(call_tool "idea" "{\"action\":\"archive\",\"ideaId\":\"$IDEA1_ID\"}")
TEXT=$(get_text "$RAW")
ARC_STATUS=$(jq_field "$TEXT" "['status']")
assert "idea(archive) status=archived" "archived" "$ARC_STATUS"

# Test 14: idea validation - missing name
RAW=$(call_tool "idea" '{"action":"create","description":"no name"}')
ERR=$(is_error "$RAW")
assert "idea(create) missing name returns isError" "true" "$ERR"

# Test 15: idea validation - missing ideaId for update
RAW=$(call_tool "idea" '{"action":"update","name":"test"}')
ERR=$(is_error "$RAW")
assert "idea(update) missing ideaId returns isError" "true" "$ERR"

echo ""

# ═══════════════════════════════════════════════════════════════
echo "── Phase 3: Session + Concept Tracking ───────────────────"
# ═══════════════════════════════════════════════════════════════

# Test 16: session start
RAW=$(call_tool "session" "{\"action\":\"start\",\"ideaId\":\"$IDEA2_ID\",\"appId\":\"command-center\",\"title\":\"E2E Test Session\"}")
TEXT=$(get_text "$RAW")
SESSION_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "session(start) returns id" "$SESSION_ID"
assert "session(start) status=active" "active" "$(jq_field "$TEXT" "['status']")"

# Test 17: concept create OPEN with sessionId
RAW=$(call_tool "concept" "{\"action\":\"create\",\"type\":\"OPEN\",\"content\":\"E2E: How should the test framework handle concurrent sessions?\",\"ideaOrigin\":\"$IDEA2_ID\",\"scopeTags\":[\"testing\",\"architecture\"],\"sessionId\":\"$SESSION_ID\"}")
TEXT=$(get_text "$RAW")
CONCEPT1_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "concept(create) OPEN returns id" "$CONCEPT1_ID"
assert "concept(create) type=OPEN" "OPEN" "$(jq_field "$TEXT" "['type']")"

# Test 18: concept create DECISION with sessionId
RAW=$(call_tool "concept" "{\"action\":\"create\",\"type\":\"DECISION\",\"content\":\"E2E: Use sequential test execution because parallel tests share Firebase state and could conflict\",\"ideaOrigin\":\"$IDEA2_ID\",\"scopeTags\":[\"testing\"],\"sessionId\":\"$SESSION_ID\"}")
TEXT=$(get_text "$RAW")
CONCEPT2_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "concept(create) DECISION returns id" "$CONCEPT2_ID"

# Test 19: concept create RULE with sessionId
RAW=$(call_tool "concept" "{\"action\":\"create\",\"type\":\"RULE\",\"content\":\"E2E: All test data must use the prefix E2E to distinguish from production data\",\"ideaOrigin\":\"$IDEA2_ID\",\"scopeTags\":[\"testing\",\"data-model\"],\"sessionId\":\"$SESSION_ID\"}")
TEXT=$(get_text "$RAW")
CONCEPT3_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "concept(create) RULE returns id" "$CONCEPT3_ID"

# Test 20: concept create CONSTRAINT with sessionId
RAW=$(call_tool "concept" "{\"action\":\"create\",\"type\":\"CONSTRAINT\",\"content\":\"E2E: Firebase RTDB has no delete-on-TTL, so test data persists until manually removed\",\"ideaOrigin\":\"$IDEA2_ID\",\"scopeTags\":[\"testing\",\"architecture\"],\"sessionId\":\"$SESSION_ID\"}")
TEXT=$(get_text "$RAW")
CONCEPT4_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "concept(create) CONSTRAINT returns id" "$CONCEPT4_ID"

# Test 21: session get — verify concept tracking
RAW=$(call_tool "session" "{\"action\":\"get\",\"sessionId\":\"$SESSION_ID\"}")
TEXT=$(get_text "$RAW")
CREATED_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('conceptsCreated',[])))")
OPEN_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('metadata',{}).get('conceptCount',{}).get('OPEN',0))")
DEC_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('metadata',{}).get('conceptCount',{}).get('DECISION',0))")
RULE_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('metadata',{}).get('conceptCount',{}).get('RULE',0))")
CONST_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('metadata',{}).get('conceptCount',{}).get('CONSTRAINT',0))")
EVENT_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('events',[])))")
assert "session tracks 4 conceptsCreated" "4" "$CREATED_COUNT"
assert "session conceptCount.OPEN=1" "1" "$OPEN_COUNT"
assert "session conceptCount.DECISION=1" "1" "$DEC_COUNT"
assert "session conceptCount.RULE=1" "1" "$RULE_COUNT"
assert "session conceptCount.CONSTRAINT=1" "1" "$CONST_COUNT"
assert "session has 4 events" "4" "$EVENT_COUNT"

# Test 22: session add_event
RAW=$(call_tool "session" "{\"action\":\"add_event\",\"sessionId\":\"$SESSION_ID\",\"eventType\":\"tangent_captured\",\"detail\":\"Routed testing framework concept to architecture idea\"}")
TEXT=$(get_text "$RAW")
assert_contains "session(add_event) returns event" "tangent_captured" "$TEXT"

# Test 23: session update
RAW=$(call_tool "session" "{\"action\":\"update\",\"sessionId\":\"$SESSION_ID\",\"title\":\"E2E Test Session - Updated Title\"}")
TEXT=$(get_text "$RAW")
assert_contains "session(update) title changed" "Updated Title" "$TEXT"

# Test 24: session complete
RAW=$(call_tool "session" "{\"action\":\"complete\",\"sessionId\":\"$SESSION_ID\",\"summary\":\"E2E test session completed. Created 4 concepts (1 OPEN, 1 DECISION, 1 RULE, 1 CONSTRAINT). All concept tracking verified.\"}")
TEXT=$(get_text "$RAW")
assert "session(complete) status=completed" "completed" "$(jq_field "$TEXT" "['status']")"
assert_not_empty "session(complete) has completedAt" "$(jq_field "$TEXT" "['completedAt']")"

# Test 25: session validation - can't update completed session
RAW=$(call_tool "session" "{\"action\":\"update\",\"sessionId\":\"$SESSION_ID\",\"title\":\"should fail\"}")
ERR=$(is_error "$RAW")
assert "session(update) completed session returns isError" "true" "$ERR"

# Test 26: session validation - can't complete completed session
RAW=$(call_tool "session" "{\"action\":\"complete\",\"sessionId\":\"$SESSION_ID\",\"summary\":\"should fail\"}")
ERR=$(is_error "$RAW")
assert "session(complete) completed session returns isError" "true" "$ERR"

echo ""

# ═══════════════════════════════════════════════════════════════
echo "── Phase 4: Concept Mutations ────────────────────────────"
# ═══════════════════════════════════════════════════════════════

# Test 27: concept update
RAW=$(call_tool "concept" "{\"action\":\"update\",\"conceptId\":\"$CONCEPT1_ID\",\"content\":\"E2E: UPDATED - How should the test framework handle concurrent sessions?\"}")
TEXT=$(get_text "$RAW")
assert_contains "concept(update) content changed" "UPDATED" "$TEXT"

# Test 28: concept update scopeTags
RAW=$(call_tool "concept" "{\"action\":\"update\",\"conceptId\":\"$CONCEPT1_ID\",\"scopeTags\":[\"testing\",\"architecture\",\"concurrency\"]}")
TEXT=$(get_text "$RAW")
assert_contains "concept(update) scopeTags changed" "concurrency" "$TEXT"

# Test 29: concept transition OPEN→DECISION (valid)
RAW=$(call_tool "concept" "{\"action\":\"transition\",\"conceptId\":\"$CONCEPT1_ID\",\"newType\":\"DECISION\"}")
TEXT=$(get_text "$RAW")
NEW_CONCEPT_FROM_TRANSITION=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('newConcept',{}).get('id',''))")
assert_not_empty "concept(transition) OPEN→DECISION creates new concept" "$NEW_CONCEPT_FROM_TRANSITION"
assert "concept(transition) new type=DECISION" "DECISION" "$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('newConcept',{}).get('type',''))")"

# Verify old concept is now transitioned
RAW=$(call_tool "list_concepts" "{\"ideaId\":\"$IDEA2_ID\",\"status\":\"transitioned\"}")
TEXT=$(get_text "$RAW")
assert_contains "original OPEN now status=transitioned" "$CONCEPT1_ID" "$TEXT"

# Test 30: concept transition invalid (DECISION→CONSTRAINT)
RAW=$(call_tool "concept" "{\"action\":\"transition\",\"conceptId\":\"$CONCEPT2_ID\",\"newType\":\"CONSTRAINT\"}")
ERR=$(is_error "$RAW")
assert "concept(transition) DECISION→CONSTRAINT rejected" "true" "$ERR"

# Test 31: concept transition valid DECISION→RULE
RAW=$(call_tool "concept" "{\"action\":\"transition\",\"conceptId\":\"$CONCEPT2_ID\",\"newType\":\"RULE\"}")
TEXT=$(get_text "$RAW")
assert "concept(transition) DECISION→RULE valid" "RULE" "$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('newConcept',{}).get('type',''))")"

# Test 32: concept supersede (RULE with new content)
RAW=$(call_tool "concept" "{\"action\":\"supersede\",\"conceptId\":\"$CONCEPT3_ID\",\"newContent\":\"E2E: SUPERSEDED - All test data must use E2E_ prefix and include timestamp for uniqueness\"}")
TEXT=$(get_text "$RAW")
SUPERSEDED_NEW_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "concept(supersede) creates new concept" "$SUPERSEDED_NEW_ID"
assert "concept(supersede) keeps same type RULE" "RULE" "$(jq_field "$TEXT" "['type']")"
assert_contains "concept(supersede) has new content" "SUPERSEDED" "$TEXT"

# Test 33: concept resolve (OPEN — but we'll resolve concept4 CONSTRAINT for testing)
RAW=$(call_tool "concept" "{\"action\":\"resolve\",\"conceptId\":\"$CONCEPT4_ID\"}")
TEXT=$(get_text "$RAW")
assert "concept(resolve) status=resolved" "resolved" "$(jq_field "$TEXT" "['status']")"

# Test 34: concept transition CONSTRAINT with scope tag flagging
# First create a new CONSTRAINT and DECISION with overlapping tags
RAW=$(call_tool "concept" "{\"action\":\"create\",\"type\":\"CONSTRAINT\",\"content\":\"E2E: Cloud Run cold starts take 3-5 seconds\",\"ideaOrigin\":\"$IDEA2_ID\",\"scopeTags\":[\"infrastructure\",\"performance\"]}")
TEXT=$(get_text "$RAW")
FLAG_CONSTRAINT_ID=$(jq_field "$TEXT" "['id']")

RAW=$(call_tool "concept" "{\"action\":\"create\",\"type\":\"DECISION\",\"content\":\"E2E: Accept cold start latency as tradeoff for cost savings\",\"ideaOrigin\":\"$IDEA2_ID\",\"scopeTags\":[\"infrastructure\",\"performance\"]}")
TEXT=$(get_text "$RAW")
FLAG_DECISION_ID=$(jq_field "$TEXT" "['id']")

# Now transition the CONSTRAINT → DECISION, should flag the DECISION above
RAW=$(call_tool "concept" "{\"action\":\"transition\",\"conceptId\":\"$FLAG_CONSTRAINT_ID\",\"newType\":\"DECISION\"}")
TEXT=$(get_text "$RAW")
HAS_FLAGGED=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print('true' if d.get('flaggedForReview') else 'false')")
FLAGGED_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('flaggedForReview',[])))")
assert "CONSTRAINT transition flags related concepts" "true" "$HAS_FLAGGED"
assert "flaggedForReview count > 0" "true" "$([ "$FLAGGED_COUNT" -gt 0 ] && echo true || echo false)"

# Test 35: concept validation - missing required params
RAW=$(call_tool "concept" '{"action":"create"}')
ERR=$(is_error "$RAW")
assert "concept(create) missing type returns isError" "true" "$ERR"

RAW=$(call_tool "concept" '{"action":"transition"}')
ERR=$(is_error "$RAW")
assert "concept(transition) missing conceptId returns isError" "true" "$ERR"

RAW=$(call_tool "concept" '{"action":"supersede","conceptId":"test"}')
ERR=$(is_error "$RAW")
assert "concept(supersede) missing newContent returns isError" "true" "$ERR"

echo ""

# ═══════════════════════════════════════════════════════════════
echo "── Phase 5: Job Lifecycle + Concept Cross-Tracking ───────"
# ═══════════════════════════════════════════════════════════════

# Test 36: job start
RAW=$(call_tool "job" '{"action":"start","appId":"command-center","title":"E2E Test Job","preConditions":"Testing from curl","exceptionsNoted":["No real code changes","Test data only"]}')
TEXT=$(get_text "$RAW")
JOB_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "job(start) returns id" "$JOB_ID"
assert "job(start) status=active" "active" "$(jq_field "$TEXT" "['status']")"
assert "job(start) preConditions set" "Testing from curl" "$(jq_field "$TEXT" "['preConditions']")"
EXCEPTIONS_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('exceptionsNoted',[])))")
assert "job(start) exceptionsNoted has 2 items" "2" "$EXCEPTIONS_COUNT"

# Test 37: concept create with jobId (cross-tracking)
RAW=$(call_tool "concept" "{\"action\":\"create\",\"type\":\"OPEN\",\"content\":\"E2E: Job-tracked concept — does the job record update correctly?\",\"ideaOrigin\":\"$IDEA2_ID\",\"jobId\":\"$JOB_ID\"}")
TEXT=$(get_text "$RAW")
JOB_CONCEPT_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "concept(create) with jobId returns id" "$JOB_CONCEPT_ID"

# Verify job record was updated
RAW=$(call_tool "job" "{\"action\":\"get\",\"jobId\":\"$JOB_ID\"}")
TEXT=$(get_text "$RAW")
JOB_CONCEPTS_CREATED=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('conceptsCreated',[])))")
JOB_TOOL_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('metadata',{}).get('toolCallCount',0))")
JOB_EVENTS=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('events',[])))")
assert "job tracks conceptsCreated" "1" "$JOB_CONCEPTS_CREATED"
assert "job increments toolCallCount" "1" "$JOB_TOOL_COUNT"
assert "job has concept_created event" "1" "$JOB_EVENTS"

# Test 38: concept transition with jobId (should track both modified + created)
RAW=$(call_tool "concept" "{\"action\":\"transition\",\"conceptId\":\"$JOB_CONCEPT_ID\",\"newType\":\"DECISION\",\"jobId\":\"$JOB_ID\"}")
TEXT=$(get_text "$RAW")
JOB_TRANSITION_NEW_ID=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('newConcept',{}).get('id',''))")

# Verify job has both modified and created records
RAW=$(call_tool "job" "{\"action\":\"get\",\"jobId\":\"$JOB_ID\"}")
TEXT=$(get_text "$RAW")
JOB_MODIFIED=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('conceptsModified',[])))")
JOB_CREATED_2=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('conceptsCreated',[])))")
assert "job tracks conceptsModified after transition" "1" "$JOB_MODIFIED"
assert "job tracks 2 conceptsCreated after transition" "2" "$JOB_CREATED_2"

# Test 39: job add_event (file_changed)
RAW=$(call_tool "job" "{\"action\":\"add_event\",\"jobId\":\"$JOB_ID\",\"eventType\":\"file_changed\",\"detail\":\"Modified src/tools/concepts.ts\",\"refId\":\"src/tools/concepts.ts\"}")
TEXT=$(get_text "$RAW")
assert_contains "job(add_event) file_changed" "file_changed" "$TEXT"

# Verify filesChanged auto-populated
RAW=$(call_tool "job" "{\"action\":\"get\",\"jobId\":\"$JOB_ID\"}")
TEXT=$(get_text "$RAW")
FILES_CHANGED=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('filesChanged',[])))")
assert "job filesChanged auto-populated" "1" "$FILES_CHANGED"

# Test 40: job add_event (concept_addressed)
RAW=$(call_tool "job" "{\"action\":\"add_event\",\"jobId\":\"$JOB_ID\",\"eventType\":\"concept_addressed\",\"detail\":\"Addressed testing concept\",\"refId\":\"$CONCEPT3_ID\"}")
TEXT=$(get_text "$RAW")

RAW=$(call_tool "job" "{\"action\":\"get\",\"jobId\":\"$JOB_ID\"}")
TEXT=$(get_text "$RAW")
CONCEPTS_ADDRESSED=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('conceptsAddressed',[])))")
assert "job conceptsAddressed auto-populated" "1" "$CONCEPTS_ADDRESSED"

# Test 41: job add_event (blocker)
RAW=$(call_tool "job" "{\"action\":\"add_event\",\"jobId\":\"$JOB_ID\",\"eventType\":\"blocker\",\"detail\":\"E2E: Simulated blocker for testing\"}")
TEXT=$(get_text "$RAW")
assert_contains "job(add_event) blocker" "blocker" "$TEXT"

# Test 42: job update
RAW=$(call_tool "job" "{\"action\":\"update\",\"jobId\":\"$JOB_ID\",\"preConditions\":\"Updated pre-conditions during test\"}")
TEXT=$(get_text "$RAW")
assert_contains "job(update) preConditions changed" "Updated pre-conditions" "$TEXT"

# Test 43: job complete
RAW=$(call_tool "job" "{\"action\":\"complete\",\"jobId\":\"$JOB_ID\",\"status\":\"completed\",\"summary\":\"E2E test job completed successfully. Verified concept cross-tracking, file change tracking, and event logging.\",\"filesChanged\":[\"src/tools/concepts.ts\",\"src/tools/sessions.ts\"],\"testsRun\":45,\"testsPassed\":45,\"testsFailed\":0,\"buildSuccess\":true,\"linesAdded\":500,\"linesRemoved\":200}")
TEXT=$(get_text "$RAW")
assert "job(complete) status=completed" "completed" "$(jq_field "$TEXT" "['status']")"
DURATION=$(jq_field "$TEXT" "['duration']")
assert "job(complete) duration calculated" "true" "$([ "$DURATION" -gt 0 ] 2>/dev/null && echo true || echo false)"
# Verify merged filesChanged (accumulated + completion)
FINAL_FILES=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('filesChanged',[])))")
assert "job(complete) filesChanged merged (2 unique)" "2" "$FINAL_FILES"
TESTS_RUN=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('outcome',{}).get('testsRun',0))")
assert "job(complete) testsRun=45" "45" "$TESTS_RUN"
BUILD=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('outcome',{}).get('buildSuccess'))")
assert "job(complete) buildSuccess=True" "True" "$BUILD"

# Test 44: job validation - can't update completed job
RAW=$(call_tool "job" "{\"action\":\"update\",\"jobId\":\"$JOB_ID\",\"title\":\"should fail\"}")
ERR=$(is_error "$RAW")
assert "job(update) completed job returns isError" "true" "$ERR"

# Test 45: job validation - can't complete completed job
RAW=$(call_tool "job" "{\"action\":\"complete\",\"jobId\":\"$JOB_ID\",\"status\":\"completed\",\"summary\":\"should fail\"}")
ERR=$(is_error "$RAW")
assert "job(complete) completed job returns isError" "true" "$ERR"

echo ""

# ═══════════════════════════════════════════════════════════════
echo "── Phase 6: Read Tools & Generation ──────────────────────"
# ═══════════════════════════════════════════════════════════════

# Test 46: list_concepts for test idea
RAW=$(call_tool "list_concepts" "{\"ideaId\":\"$IDEA2_ID\"}")
TEXT=$(get_text "$RAW")
CONCEPT_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d['items']))")
assert "list_concepts returns concepts for idea" "true" "$([ "$CONCEPT_COUNT" -gt 0 ] && echo true || echo false)"

# Test 47: list_concepts filter by type
RAW=$(call_tool "list_concepts" "{\"ideaId\":\"$IDEA2_ID\",\"type\":\"RULE\"}")
TEXT=$(get_text "$RAW")
RULE_ONLY=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); items=d['items']; print(all(c['type']=='RULE' for c in items) if items else True)")
assert "list_concepts type=RULE only returns RULEs" "True" "$RULE_ONLY"

# Test 48: list_concepts filter by status
RAW=$(call_tool "list_concepts" "{\"ideaId\":\"$IDEA2_ID\",\"status\":\"active\"}")
TEXT=$(get_text "$RAW")
ACTIVE_ONLY=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); items=d['items']; print(all(c['status']=='active' for c in items) if items else True)")
assert "list_concepts status=active only returns active" "True" "$ACTIVE_ONLY"

# Test 49: list_concepts filter by appId
RAW=$(call_tool "list_concepts" '{"appId":"command-center","status":"active"}')
TEXT=$(get_text "$RAW")
APP_CONCEPTS=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d['items']))")
assert "list_concepts by appId returns concepts" "true" "$([ "$APP_CONCEPTS" -gt 0 ] && echo true || echo false)"

# Test 50: get_active_concepts
RAW=$(call_tool "get_active_concepts" '{"appId":"command-center"}')
TEXT=$(get_text "$RAW")
HAS_RULES=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print('rules' in d)")
HAS_OPENS=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print('opens' in d)")
HAS_DECISIONS=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print('decisions' in d)")
HAS_CONSTRAINTS=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print('constraints' in d)")
assert "get_active_concepts has rules" "True" "$HAS_RULES"
assert "get_active_concepts has opens" "True" "$HAS_OPENS"
assert "get_active_concepts has decisions" "True" "$HAS_DECISIONS"
assert "get_active_concepts has constraints" "True" "$HAS_CONSTRAINTS"

# Test 51: generate_claude_md
RAW=$(call_tool "generate_claude_md" '{"appId":"command-center","appName":"Command Center"}')
TEXT=$(get_text "$RAW")
assert_contains "generate_claude_md has title" "CLAUDE.md" "$TEXT"
assert_contains "generate_claude_md has RULEs section" "RULEs" "$TEXT"
assert_contains "generate_claude_md has CONSTRAINTs section" "CONSTRAINTs" "$TEXT"
assert_contains "generate_claude_md has DECISIONs section" "DECISIONs" "$TEXT"
assert_contains "generate_claude_md has OPENs section" "OPENs" "$TEXT"

# Test: generate_claude_md now persists — retrieve it
RAW=$(call_tool "generate_claude_md" '{"action":"get","appId":"command-center"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "generate_claude_md(get) not error" "false" "$ERR"
assert_contains "generate_claude_md(get) has content" "CLAUDE.md" "$TEXT"
assert_contains "generate_claude_md(get) has appName" "Command Center" "$TEXT"
assert_contains "generate_claude_md(get) has generatedAt" "generatedAt" "$TEXT"
assert_contains "generate_claude_md(get) has conceptCount" "conceptCount" "$TEXT"

# Test: generate_claude_md(get) for nonexistent app
RAW=$(call_tool "generate_claude_md" '{"action":"get","appId":"nonexistent-app-xyz"}')
ERR=$(is_error "$RAW")
assert "generate_claude_md(get) nonexistent returns isError" "true" "$ERR"

echo ""

# ═══════════════════════════════════════════════════════════════
echo "── Phase 7: Edge Cases & Validation ──────────────────────"
# ═══════════════════════════════════════════════════════════════

# Test 52: session start missing ideaId
RAW=$(call_tool "session" '{"action":"start","title":"no idea"}')
ERR=$(is_error "$RAW")
assert "session(start) missing ideaId returns isError" "true" "$ERR"

# Test 53: session start missing title
RAW=$(call_tool "session" '{"action":"start","ideaId":"test"}')
ERR=$(is_error "$RAW")
assert "session(start) missing title returns isError" "true" "$ERR"

# Test 54: session get nonexistent
RAW=$(call_tool "session" '{"action":"get","sessionId":"nonexistent-session-xyz"}')
ERR=$(is_error "$RAW")
assert "session(get) nonexistent returns isError" "true" "$ERR"

# Test 55: job start missing appId
RAW=$(call_tool "job" '{"action":"start","title":"no app"}')
ERR=$(is_error "$RAW")
assert "job(start) missing appId returns isError" "true" "$ERR"

# Test 56: job get nonexistent
RAW=$(call_tool "job" '{"action":"get","jobId":"nonexistent-job-xyz"}')
ERR=$(is_error "$RAW")
assert "job(get) nonexistent returns isError" "true" "$ERR"

# Test 57: concept get nonexistent for update
RAW=$(call_tool "concept" '{"action":"update","conceptId":"nonexistent-concept-xyz"}')
ERR=$(is_error "$RAW")
assert "concept(update) nonexistent returns isError" "true" "$ERR"

# Test 58: concept resolve nonexistent
RAW=$(call_tool "concept" '{"action":"resolve","conceptId":"nonexistent-concept-xyz"}')
ERR=$(is_error "$RAW")
assert "concept(resolve) nonexistent returns isError" "true" "$ERR"

# Test 59: session list with filters
RAW=$(call_tool "session" '{"action":"list","status":"completed"}')
TEXT=$(get_text "$RAW")
COMPLETED_SESSIONS=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); items=d['items']; print(all(s['status']=='completed' for s in items) if items else True)")
assert "session(list) status filter works" "True" "$COMPLETED_SESSIONS"

# Test 60: job list with filters
RAW=$(call_tool "job" '{"action":"list","status":"completed"}')
TEXT=$(get_text "$RAW")
COMPLETED_JOBS=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); items=d['items']; print(all(j['status']=='completed' for j in items) if items else True)")
assert "job(list) status filter works" "True" "$COMPLETED_JOBS"

# Test 61: concept create + session + job simultaneously
RAW2=$(call_tool "session" "{\"action\":\"start\",\"ideaId\":\"$IDEA2_ID\",\"appId\":\"command-center\",\"title\":\"E2E dual-tracking session\"}")
TEXT2=$(get_text "$RAW2")
DUAL_SESSION_ID=$(jq_field "$TEXT2" "['id']")

RAW3=$(call_tool "job" '{"action":"start","appId":"command-center","title":"E2E dual-tracking job"}')
TEXT3=$(get_text "$RAW3")
DUAL_JOB_ID=$(jq_field "$TEXT3" "['id']")

RAW4=$(call_tool "concept" "{\"action\":\"create\",\"type\":\"OPEN\",\"content\":\"E2E: Dual-tracked concept — session AND job\",\"ideaOrigin\":\"$IDEA2_ID\",\"sessionId\":\"$DUAL_SESSION_ID\",\"jobId\":\"$DUAL_JOB_ID\"}")
TEXT4=$(get_text "$RAW4")
DUAL_CONCEPT_ID=$(jq_field "$TEXT4" "['id']")

# Verify session got it
RAW5=$(call_tool "session" "{\"action\":\"get\",\"sessionId\":\"$DUAL_SESSION_ID\"}")
TEXT5=$(get_text "$RAW5")
DUAL_SESSION_CONCEPTS=$(echo "$TEXT5" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('conceptsCreated',[])))")
assert "dual-tracking: session got concept" "1" "$DUAL_SESSION_CONCEPTS"

# Verify job got it
RAW6=$(call_tool "job" "{\"action\":\"get\",\"jobId\":\"$DUAL_JOB_ID\"}")
TEXT6=$(get_text "$RAW6")
DUAL_JOB_CONCEPTS=$(echo "$TEXT6" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('conceptsCreated',[])))")
assert "dual-tracking: job got concept" "1" "$DUAL_JOB_CONCEPTS"

# Clean up dual session/job
call_tool "session" "{\"action\":\"complete\",\"sessionId\":\"$DUAL_SESSION_ID\",\"summary\":\"E2E dual-tracking test complete\"}" > /dev/null
call_tool "job" "{\"action\":\"complete\",\"jobId\":\"$DUAL_JOB_ID\",\"status\":\"completed\",\"summary\":\"E2E dual-tracking test complete\"}" > /dev/null

echo ""

# ═══════════════════════════════════════════════════════════════
echo "── Phase 8: Document Queue ───────────────────────────────"
# ═══════════════════════════════════════════════════════════════

# Test: document push
RAW=$(call_tool "document" "{\"action\":\"push\",\"type\":\"spec\",\"appId\":\"command-center\",\"content\":\"# E2E Test Spec\\n\\nThis is a test document.\",\"targetPath\":\"specs/e2e-test.md\",\"metadata\":\"{\\\"ideaId\\\":\\\"$IDEA2_ID\\\",\\\"purpose\\\":\\\"testing\\\"}\"}")
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
DOC1_ID=$(jq_field "$TEXT" "['id']")
DOC1_STATUS=$(jq_field "$TEXT" "['status']")
DOC1_TYPE=$(jq_field "$TEXT" "['type']")
DOC1_TARGET=$(jq_field "$TEXT" "['routing']['targetPath']")
DOC1_CREATED_BY=$(jq_field "$TEXT" "['createdBy']")
assert "document(push) not error" "false" "$ERR"
assert_not_empty "document(push) has id" "$DOC1_ID"
assert "document(push) status=pending" "pending" "$DOC1_STATUS"
assert "document(push) type=spec" "spec" "$DOC1_TYPE"
assert "document(push) targetPath" "specs/e2e-test.md" "$DOC1_TARGET"
assert "document(push) default createdBy" "claude-chat" "$DOC1_CREATED_BY"
DOC1_LIFESPAN=$(jq_field "$TEXT" "['lifespan']")
assert "document(push) spec default lifespan=short" "short" "$DOC1_LIFESPAN"

# Test: document push with custom createdBy
RAW=$(call_tool "document" '{"action":"push","type":"architecture","appId":"command-center","content":"# Architecture Doc","targetPath":"docs/architecture.md","createdBy":"claude-code"}')
TEXT=$(get_text "$RAW")
DOC2_ID=$(jq_field "$TEXT" "['id']")
DOC2_CREATED_BY=$(jq_field "$TEXT" "['createdBy']")
assert_not_empty "document(push) doc2 has id" "$DOC2_ID"
assert "document(push) custom createdBy" "claude-code" "$DOC2_CREATED_BY"
DOC2_LIFESPAN=$(jq_field "$TEXT" "['lifespan']")
assert "document(push) architecture default lifespan=short" "short" "$DOC2_LIFESPAN"

# Test: document push with explicit lifespan
RAW=$(call_tool "document" '{"action":"push","type":"spec","appId":"command-center","content":"# Permanent Spec","targetPath":"specs/permanent.md","lifespan":"permanent"}')
TEXT=$(get_text "$RAW")
DOC_PERM_ID=$(jq_field "$TEXT" "['id']")
DOC_PERM_LIFESPAN=$(jq_field "$TEXT" "['lifespan']")
assert "document(push) explicit lifespan=permanent" "permanent" "$DOC_PERM_LIFESPAN"

# Test: document push validation — missing type
RAW=$(call_tool "document" '{"action":"push","appId":"command-center","content":"missing type","targetPath":"test.md"}')
ERR=$(is_error "$RAW")
assert "document(push) missing type returns isError" "true" "$ERR"

# Test: document push validation — missing content
RAW=$(call_tool "document" '{"action":"push","type":"spec","appId":"command-center","targetPath":"test.md"}')
ERR=$(is_error "$RAW")
assert "document(push) missing content returns isError" "true" "$ERR"

# Test: document push validation — missing targetPath
RAW=$(call_tool "document" '{"action":"push","type":"spec","appId":"command-center","content":"no path"}')
ERR=$(is_error "$RAW")
assert "document(push) missing targetPath returns isError" "true" "$ERR"

# Test: document push validation — missing appId
RAW=$(call_tool "document" '{"action":"push","type":"spec","content":"no app","targetPath":"test.md"}')
ERR=$(is_error "$RAW")
assert "document(push) missing appId returns isError" "true" "$ERR"

# Test: document list (default pending) — returns {items:[], total:N, offset:0, limit:20} or with _purged:N
RAW=$(call_tool "document" '{"action":"list","appId":"command-center"}')
TEXT=$(get_text "$RAW")
DOC_LIST_COUNT=$(echo "$TEXT" | python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
# Response format: {items:[], total:N, offset:0, limit:20} (may also include _purged:N)
docs = d.get('items', d) if isinstance(d, dict) else d
print(len([x for x in docs if x['status']=='pending']))
")
assert "document(list) has pending docs" "True" "$([ "$DOC_LIST_COUNT" -ge 2 ] && echo True || echo False)"

# Test: document list with type filter
RAW=$(call_tool "document" '{"action":"list","appId":"command-center","type":"spec"}')
TEXT=$(get_text "$RAW")
DOC_TYPE_COUNT=$(echo "$TEXT" | python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
docs = d.get('items', d) if isinstance(d, dict) else d
print(all(x['type']=='spec' for x in docs))
")
assert "document(list) type filter works" "True" "$DOC_TYPE_COUNT"

# Test: document get
RAW=$(call_tool "document" "{\"action\":\"get\",\"docId\":\"$DOC1_ID\"}")
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
GET_DOC_TYPE=$(jq_field "$TEXT" "['type']")
assert "document(get) not error" "false" "$ERR"
assert "document(get) type matches" "spec" "$GET_DOC_TYPE"
assert_contains "document(get) has content" "E2E Test Spec" "$TEXT"

# Test: document get nonexistent
RAW=$(call_tool "document" '{"action":"get","docId":"nonexistent-doc-xyz"}')
ERR=$(is_error "$RAW")
assert "document(get) nonexistent returns isError" "true" "$ERR"

# Test: document deliver
RAW=$(call_tool "document" "{\"action\":\"deliver\",\"docId\":\"$DOC1_ID\"}")
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
DELIVERED_STATUS=$(jq_field "$TEXT" "['status']")
DELIVERED_BY=$(jq_field "$TEXT" "['deliveredBy']")
assert "document(deliver) not error" "false" "$ERR"
assert "document(deliver) status=delivered" "delivered" "$DELIVERED_STATUS"
assert "document(deliver) default deliveredBy" "claude-code" "$DELIVERED_BY"
DELIVERED_LIFESPAN=$(jq_field "$TEXT" "['lifespan']")
assert "document(deliver) preserves lifespan=short" "short" "$DELIVERED_LIFESPAN"

# Test: document deliver with custom deliveredBy
RAW=$(call_tool "document" "{\"action\":\"deliver\",\"docId\":\"$DOC2_ID\",\"deliveredBy\":\"user\"}")
TEXT=$(get_text "$RAW")
DELIVERED_BY2=$(jq_field "$TEXT" "['deliveredBy']")
assert "document(deliver) custom deliveredBy" "user" "$DELIVERED_BY2"

# Test: document deliver already-delivered doc → isError
RAW=$(call_tool "document" "{\"action\":\"deliver\",\"docId\":\"$DOC1_ID\"}")
ERR=$(is_error "$RAW")
assert "document(deliver) already delivered returns isError" "true" "$ERR"

# Test: document fail — push a new doc to test failure
RAW=$(call_tool "document" '{"action":"push","type":"test-plan","appId":"command-center","content":"# Fail Test","targetPath":"test-plan.md"}')
TEXT=$(get_text "$RAW")
DOC3_ID=$(jq_field "$TEXT" "['id']")

RAW=$(call_tool "document" "{\"action\":\"fail\",\"docId\":\"$DOC3_ID\",\"reason\":\"E2E test: simulated failure\"}")
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
FAILED_STATUS=$(jq_field "$TEXT" "['status']")
assert "document(fail) not error" "false" "$ERR"
assert "document(fail) status=failed" "failed" "$FAILED_STATUS"
assert_contains "document(fail) has reason" "simulated failure" "$TEXT"

# Test: document fail without reason → isError
RAW=$(call_tool "document" "{\"action\":\"fail\",\"docId\":\"$DOC3_ID\"}")
ERR=$(is_error "$RAW")
assert "document(fail) missing reason returns isError" "true" "$ERR"

# Test: document fail already-failed doc → isError
RAW=$(call_tool "document" "{\"action\":\"fail\",\"docId\":\"$DOC3_ID\",\"reason\":\"double fail\"}")
ERR=$(is_error "$RAW")
assert "document(fail) already failed returns isError" "true" "$ERR"

# Test: document list with status filter (delivered)
RAW=$(call_tool "document" '{"action":"list","appId":"command-center","status":"delivered"}')
TEXT=$(get_text "$RAW")
DELIVERED_ONLY=$(echo "$TEXT" | python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
docs = d.get('items', d) if isinstance(d, dict) else d
print(all(x['status']=='delivered' for x in docs) if docs else True)
")
assert "document(list) status=delivered filter" "True" "$DELIVERED_ONLY"

# Test: document list status=all shows everything
RAW=$(call_tool "document" '{"action":"list","appId":"command-center","status":"all"}')
TEXT=$(get_text "$RAW")
ALL_STATUSES=$(echo "$TEXT" | python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
docs = d.get('items', d) if isinstance(d, dict) else d
statuses=set(x['status'] for x in docs)
print(len(statuses))
")
assert "document(list) status=all has multiple statuses" "True" "$([ "$ALL_STATUSES" -ge 2 ] && echo True || echo False)"

# Test: document deliver nonexistent → isError
RAW=$(call_tool "document" '{"action":"deliver","docId":"nonexistent-doc-xyz"}')
ERR=$(is_error "$RAW")
assert "document(deliver) nonexistent returns isError" "true" "$ERR"

echo ""

# ═══════════════════════════════════════════════════════════════
echo "── Phase 9: Job Review / Approve ─────────────────────────"
# ═══════════════════════════════════════════════════════════════

# Start a fresh job for review/approve testing
RAW=$(call_tool "job" '{"action":"start","appId":"command-center","title":"E2E review-approve test job"}')
TEXT=$(get_text "$RAW")
REVIEW_JOB_ID=$(jq_field "$TEXT" "['id']")
REVIEW_JOB_STATUS=$(jq_field "$TEXT" "['status']")
assert_not_empty "job(start) for review test has id" "$REVIEW_JOB_ID"
assert "job(start) for review test status=active" "active" "$REVIEW_JOB_STATUS"

# Test: job review — flag concerns
RAW=$(call_tool "job" "{\"action\":\"review\",\"jobId\":\"$REVIEW_JOB_ID\",\"concerns\":[\"Missing test coverage for auth module\",\"OPEN question about DB schema not resolved\"]}")
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
REVIEW_STATUS=$(jq_field "$TEXT" "['status']")
assert "job(review) not error" "false" "$ERR"
assert "job(review) status=review" "review" "$REVIEW_STATUS"
assert_contains "job(review) has concern text" "Missing test coverage" "$TEXT"
assert_contains "job(review) has reviewedAt" "reviewedAt" "$TEXT"

# Test: job review on non-active job → isError (try to review the already-reviewed job)
RAW=$(call_tool "job" "{\"action\":\"review\",\"jobId\":\"$REVIEW_JOB_ID\",\"concerns\":[\"another concern\"]}")
ERR=$(is_error "$RAW")
assert "job(review) non-active returns isError" "true" "$ERR"

# Test: job review missing concerns → isError
RAW=$(call_tool "job" '{"action":"review","jobId":"some-id"}')
ERR=$(is_error "$RAW")
assert "job(review) missing concerns returns isError" "true" "$ERR"

# Test: job review empty concerns → isError
RAW=$(call_tool "job" "{\"action\":\"review\",\"jobId\":\"$REVIEW_JOB_ID\",\"concerns\":[]}")
ERR=$(is_error "$RAW")
assert "job(review) empty concerns returns isError" "true" "$ERR"

# Test: job approve
RAW=$(call_tool "job" "{\"action\":\"approve\",\"jobId\":\"$REVIEW_JOB_ID\",\"resolutions\":\"Auth tests added in separate PR, DB schema OPEN deferred\"}")
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
APPROVE_STATUS=$(jq_field "$TEXT" "['status']")
assert "job(approve) not error" "false" "$ERR"
assert "job(approve) status=approved" "approved" "$APPROVE_STATUS"
assert_contains "job(approve) has resolutions" "Auth tests added" "$TEXT"
assert_contains "job(approve) has approvedAt" "approvedAt" "$TEXT"

# Test: job approve on non-review job → isError (try to approve the already-approved job)
RAW=$(call_tool "job" "{\"action\":\"approve\",\"jobId\":\"$REVIEW_JOB_ID\"}")
ERR=$(is_error "$RAW")
assert "job(approve) non-review returns isError" "true" "$ERR"

# Test: can still add_event to approved job
RAW=$(call_tool "job" "{\"action\":\"add_event\",\"jobId\":\"$REVIEW_JOB_ID\",\"eventType\":\"note\",\"detail\":\"Build proceeding after approval\"}")
ERR=$(is_error "$RAW")
assert "job(add_event) on approved job works" "false" "$ERR"

# Test: can complete from approved state
RAW=$(call_tool "job" "{\"action\":\"complete\",\"jobId\":\"$REVIEW_JOB_ID\",\"status\":\"completed\",\"summary\":\"E2E review-approve lifecycle complete\",\"testsRun\":10,\"testsPassed\":10,\"testsFailed\":0,\"buildSuccess\":true}")
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
FINAL_STATUS=$(jq_field "$TEXT" "['status']")
assert "job(complete) from approved not error" "false" "$ERR"
assert "job(complete) from approved status=completed" "completed" "$FINAL_STATUS"
assert_contains "job(complete) has summary" "review-approve lifecycle" "$TEXT"

# Test: job review on completed job → isError
RAW=$(call_tool "job" "{\"action\":\"review\",\"jobId\":\"$REVIEW_JOB_ID\",\"concerns\":[\"too late\"]}")
ERR=$(is_error "$RAW")
assert "job(review) completed job returns isError" "true" "$ERR"

# Test: straight-through path (active → complete, no review needed)
RAW=$(call_tool "job" '{"action":"start","appId":"command-center","title":"E2E straight-through job"}')
TEXT=$(get_text "$RAW")
STRAIGHT_JOB_ID=$(jq_field "$TEXT" "['id']")

RAW=$(call_tool "job" "{\"action\":\"complete\",\"jobId\":\"$STRAIGHT_JOB_ID\",\"status\":\"completed\",\"summary\":\"No review needed, built cleanly\"}")
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
STRAIGHT_STATUS=$(jq_field "$TEXT" "['status']")
assert "job(complete) straight-through not error" "false" "$ERR"
assert "job(complete) straight-through status=completed" "completed" "$STRAIGHT_STATUS"

# Test: job list filter by status=review (should be 0 since we completed the review job)
RAW=$(call_tool "job" '{"action":"list","status":"review"}')
TEXT=$(get_text "$RAW")
REVIEW_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d['items']))")
assert "job(list) status=review filter works" "0" "$REVIEW_COUNT"

echo ""

# ═══════════════════════════════════════════════════════════════
echo "── Phase 10: Generate + Push Integration ─────────────────"
# ═══════════════════════════════════════════════════════════════

# Test: generate_claude_md action=push creates doc queue entry
RAW=$(call_tool "generate_claude_md" '{"action":"push","appId":"command-center","appName":"Command Center"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "generate_claude_md(push) not error" "false" "$ERR"
assert_contains "generate_claude_md(push) has CLAUDE.md" "CLAUDE.md" "$TEXT"
assert_contains "generate_claude_md(push) has docId" "docId" "$TEXT"
assert_contains "generate_claude_md(push) mentions queued" "queued" "$TEXT"
# Extract docId from markdown text (it appears as "docId: -Oxxxx" in the footer)
PUSHED_DOC_ID=$(echo "$TEXT" | python3 -c "
import sys, re
text = sys.stdin.read()
m = re.search(r'docId:\s*([A-Za-z0-9_-]+)', text)
print(m.group(1) if m else '')
" 2>/dev/null)

# Test: verify the pushed document exists (may be pending or delivered via GitHub auto-delivery)
# Note: claude-md has lifespan=permanent, so it won't be auto-deleted
RAW=$(call_tool "document" '{"action":"list","appId":"command-center","type":"claude-md","status":"all"}')
TEXT=$(get_text "$RAW")
CLAUDE_MD_DOCS=$(echo "$TEXT" | python3 -c "
import json,sys
try:
    d=json.loads(sys.stdin.read())
    docs = d.get('items', d) if isinstance(d, dict) else d
    print(len([x for x in docs if x['type']=='claude-md']))
except:
    print(0)
")
assert "document(list) has claude-md doc" "True" "$([ "$CLAUDE_MD_DOCS" -ge 1 ] && echo True || echo False)"

# Test: verify the pushed document has correct routing
RAW=$(call_tool "document" '{"action":"list","appId":"command-center","type":"claude-md","status":"all"}')
TEXT=$(get_text "$RAW")
CLAUDE_MD_PATH=$(echo "$TEXT" | python3 -c "
import json,sys
try:
    d=json.loads(sys.stdin.read())
    docs = d.get('items', d) if isinstance(d, dict) else d
    mds=[x for x in docs if x['type']=='claude-md']
    print(mds[0].get('targetPath', mds[0].get('routing',{}).get('targetPath','')) if mds else '')
except:
    print('')
")
assert "pushed claude-md targetPath=CLAUDE.md" "CLAUDE.md" "$CLAUDE_MD_PATH"

# Test: generate_claude_md default action still works (backward compat)
RAW=$(call_tool "generate_claude_md" '{"appId":"command-center","appName":"Command Center"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "generate_claude_md(default) not error" "false" "$ERR"
assert_contains "generate_claude_md(default) has content" "CLAUDE.md" "$TEXT"

echo ""

# ═══════════════════════════════════════════════════════════════
# Phase 11: Skill Tool
# ═══════════════════════════════════════════════════════════════
echo "Phase 11: Skill Tool"
echo "─────────────────────────────────────────────────────────"

# Test: skill list
RAW=$(call_tool "skill" '{"action":"list"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(list) not error" "false" "$ERR"
SKILL_COUNT=$(jq_field "$TEXT" "['count']")
assert "skill(list) count is 26" "26" "$SKILL_COUNT"
assert_contains "skill(list) has cc-odrc-framework" "cc-odrc-framework" "$TEXT"
assert_contains "skill(list) has cc-session-protocol" "cc-session-protocol" "$TEXT"
assert_contains "skill(list) has cc-build-protocol" "cc-build-protocol" "$TEXT"
assert_contains "skill(list) has cc-build-resume" "cc-build-resume" "$TEXT"
assert_contains "skill(list) has cc-session-resume" "cc-session-resume" "$TEXT"
assert_contains "skill(list) has cc-mcp-workflow" "cc-mcp-workflow" "$TEXT"
assert_contains "skill(list) has cc-lens-stress-test" "cc-lens-stress-test" "$TEXT"
assert_contains "skill(list) has cc-lens-voice-of-customer" "cc-lens-voice-of-customer" "$TEXT"
assert_contains "skill(list) has cc-lens-competitive" "cc-lens-competitive" "$TEXT"
assert_contains "skill(list) has cc-lens-economics" "cc-lens-economics" "$TEXT"
assert_contains "skill(list) has cc-protocol-messaging" "cc-protocol-messaging" "$TEXT"
assert_contains "skill(list) has cc-lens-integration" "cc-lens-integration" "$TEXT"
assert_contains "skill(list) has cc-lens-ux-deep-dive" "cc-lens-ux-deep-dive" "$TEXT"
assert_contains "skill(list) has cc-lens-content" "cc-lens-content" "$TEXT"
assert_contains "skill(list) has cc-lens-growth" "cc-lens-growth" "$TEXT"
assert_contains "skill(list) has cc-lens-accessibility" "cc-lens-accessibility" "$TEXT"
assert_contains "skill(list) has cc-lens-operations" "cc-lens-operations" "$TEXT"
assert_contains "skill(list) has cc-lens-security" "cc-lens-security" "$TEXT"
assert_contains "skill(list) has cc-skill-router" "cc-skill-router" "$TEXT"
assert_contains "skill(list) has cc-job-creation-protocol" "cc-job-creation-protocol" "$TEXT"

# Test: skill get — retrieve a specific skill
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-odrc-framework"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-odrc-framework) not error" "false" "$ERR"
assert_contains "skill(get cc-odrc-framework) has ODRC content" "ODRC Framework" "$TEXT"
assert_contains "skill(get cc-odrc-framework) has OPEN definition" "OPENs" "$TEXT"
assert_contains "skill(get cc-odrc-framework) has state machine" "State Machine" "$TEXT"

# Test: skill get — session protocol
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-session-protocol"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-session-protocol) not error" "false" "$ERR"
assert_contains "skill(get cc-session-protocol) has protocol content" "Session Protocol" "$TEXT"

# Test: skill get — build protocol
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-build-protocol"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-build-protocol) not error" "false" "$ERR"
assert_contains "skill(get cc-build-protocol) has build content" "Build Protocol" "$TEXT"
assert_contains "skill(get cc-build-protocol) has document check" "Pending Documents" "$TEXT"

# Test: skill get — build resume
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-build-resume"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-build-resume) not error" "false" "$ERR"
assert_contains "skill(get cc-build-resume) has recovery content" "Compaction Recovery" "$TEXT"

# Test: skill get — mcp workflow
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-mcp-workflow"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-mcp-workflow) not error" "false" "$ERR"
assert_contains "skill(get cc-mcp-workflow) has lifecycle" "IDEATE" "$TEXT"
assert_contains "skill(get cc-mcp-workflow) has tool count" "10 tools" "$TEXT"

# Test: skill get — stress test lens
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-lens-stress-test"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-lens-stress-test) not error" "false" "$ERR"
assert_contains "skill(get cc-lens-stress-test) has content" "Stress Test Lens" "$TEXT"
assert_contains "skill(get cc-lens-stress-test) has stress vectors" "stress vectors" "$TEXT"

# Test: skill get — voice of customer lens
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-lens-voice-of-customer"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-lens-voice-of-customer) not error" "false" "$ERR"
assert_contains "skill(get cc-lens-voice-of-customer) has content" "Voice of Customer Lens" "$TEXT"
assert_contains "skill(get cc-lens-voice-of-customer) has personas" "Persona" "$TEXT"

# Test: skill get — competitive lens
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-lens-competitive"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-lens-competitive) not error" "false" "$ERR"
assert_contains "skill(get cc-lens-competitive) has content" "Competitive Lens" "$TEXT"
assert_contains "skill(get cc-lens-competitive) has differentiation" "Differentiation" "$TEXT"

# Test: skill get — economics lens
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-lens-economics"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-lens-economics) not error" "false" "$ERR"
assert_contains "skill(get cc-lens-economics) has content" "Economics Lens" "$TEXT"
assert_contains "skill(get cc-lens-economics) has ROI" "ROI" "$TEXT"

# Test: skill get — messaging protocol
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-protocol-messaging"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-protocol-messaging) not error" "false" "$ERR"
assert_contains "skill(get cc-protocol-messaging) has protocol content" "Message Types" "$TEXT"
assert_contains "skill(get cc-protocol-messaging) has spec-push" "spec-push" "$TEXT"
assert_contains "skill(get cc-protocol-messaging) has build-status" "build-status" "$TEXT"

# ── New Lens Skills (Batch 2) ──

# Test: skill get — integration lens
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-lens-integration"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-lens-integration) not error" "false" "$ERR"
assert_contains "skill(get cc-lens-integration) has content" "Ecosystem Lens" "$TEXT"
assert_contains "skill(get cc-lens-integration) has coupling" "coupling" "$TEXT"

# Test: skill get — UX deep-dive lens
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-lens-ux-deep-dive"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-lens-ux-deep-dive) not error" "false" "$ERR"
assert_contains "skill(get cc-lens-ux-deep-dive) has content" "UX Deep-Dive" "$TEXT"
assert_contains "skill(get cc-lens-ux-deep-dive) has navigation" "Navigation" "$TEXT"

# Test: skill get — content lens
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-lens-content"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-lens-content) not error" "false" "$ERR"
assert_contains "skill(get cc-lens-content) has content" "Information Architecture" "$TEXT"
assert_contains "skill(get cc-lens-content) has quality" "Quality Gate" "$TEXT"

# Test: skill get — growth lens
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-lens-growth"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-lens-growth) not error" "false" "$ERR"
assert_contains "skill(get cc-lens-growth) has content" "Distribution" "$TEXT"
assert_contains "skill(get cc-lens-growth) has SEO" "SEO" "$TEXT"

# Test: skill get — accessibility lens
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-lens-accessibility"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-lens-accessibility) not error" "false" "$ERR"
assert_contains "skill(get cc-lens-accessibility) has content" "Accessibility Lens" "$TEXT"
assert_contains "skill(get cc-lens-accessibility) has WCAG" "WCAG" "$TEXT"

# Test: skill get — operations lens
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-lens-operations"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-lens-operations) not error" "false" "$ERR"
assert_contains "skill(get cc-lens-operations) has content" "Observability" "$TEXT"
assert_contains "skill(get cc-lens-operations) has monitoring" "Health Monitoring" "$TEXT"

# Test: skill get — security lens
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-lens-security"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-lens-security) not error" "false" "$ERR"
assert_contains "skill(get cc-lens-security) has content" "Security" "$TEXT"
assert_contains "skill(get cc-lens-security) has attack" "Attack Surface" "$TEXT"

RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-skill-router"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-skill-router) not error" "false" "$ERR"
assert_contains "skill(get cc-skill-router) has routing table" "Routing" "$TEXT"
assert_contains "skill(get cc-skill-router) has chat routing" "Chat Routing" "$TEXT"
assert_contains "skill(get cc-skill-router) has code routing" "Code Routing" "$TEXT"
assert_contains "skill(get cc-skill-router) has inventory" "Available Skills Inventory" "$TEXT"

RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-job-creation-protocol"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "skill(get cc-job-creation-protocol) not error" "false" "$ERR"
assert_contains "skill(get cc-job-creation-protocol) has protocol content" "Job Creation Protocol" "$TEXT"
assert_contains "skill(get cc-job-creation-protocol) has instructions format" "Build Objective" "$TEXT"
assert_contains "skill(get cc-job-creation-protocol) has concept snapshot" "conceptSnapshot" "$TEXT"

# Test: skill get — updated session-protocol has router directive
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-session-protocol"}')
TEXT=$(get_text "$RAW")
assert_contains "skill(get cc-session-protocol) has router directive" "cc-skill-router" "$TEXT"
assert_contains "skill(get cc-session-protocol) has job-creation ref" "cc-job-creation-protocol" "$TEXT"

# Test: skill get — updated build-protocol has router directive
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-build-protocol"}')
TEXT=$(get_text "$RAW")
assert_contains "skill(get cc-build-protocol) has router directive" "cc-skill-router" "$TEXT"

# Test: skill get — unknown skill returns error
RAW=$(call_tool "skill" '{"action":"get","skillName":"cc-nonexistent"}')
ERR=$(is_error "$RAW")
assert "skill(get unknown) is error" "true" "$ERR"

# Test: skill get — missing skillName returns error
RAW=$(call_tool "skill" '{"action":"get"}')
ERR=$(is_error "$RAW")
assert "skill(get no name) is error" "true" "$ERR"

echo ""

# ═══════════════════════════════════════════════════════════════
# Phase 12: Inter-Agent Messaging
# ═══════════════════════════════════════════════════════════════
echo "Phase 12: Inter-Agent Messaging"
echo "─────────────────────────────────────────────────────────"

# Test: send message from chat to code
RAW=$(call_tool "document" '{"action":"send","content":"Hello from Claude Chat! Testing the message channel.","to":"claude-code"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "send(chat→code) not error" "false" "$ERR"
MSG1_ID=$(jq_field "$TEXT" "['id']")
assert_contains "send(chat→code) has id" "-" "$MSG1_ID"
assert_contains "send(chat→code) type=message" "message" "$TEXT"
assert_contains "send(chat→code) to=claude-code" "claude-code" "$TEXT"
assert_contains "send(chat→code) from=claude-chat" "claude-chat" "$TEXT"
assert_contains "send(chat→code) status=pending" "pending" "$TEXT"
MSG1_LIFESPAN=$(jq_field "$TEXT" "['lifespan']")
assert "send(chat→code) lifespan=ephemeral" "ephemeral" "$MSG1_LIFESPAN"

# Test: send message from code to chat
RAW=$(call_tool "document" '{"action":"send","content":"Hello from Claude Code! Got your message.","to":"claude-chat","createdBy":"claude-code"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "send(code→chat) not error" "false" "$ERR"
MSG2_ID=$(jq_field "$TEXT" "['id']")
assert_contains "send(code→chat) to=claude-chat" "claude-chat" "$TEXT"
assert_contains "send(code→chat) from=claude-code" "claude-code" "$TEXT"

# Test: send with metadata
RAW=$(call_tool "document" '{"action":"send","content":"Status update: build in progress","to":"claude-chat","createdBy":"claude-code","metadata":"{\"context\":\"build-job-123\",\"urgency\":\"low\"}"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "send(with metadata) not error" "false" "$ERR"
MSG3_ID=$(jq_field "$TEXT" "['id']")
assert_contains "send(with metadata) has context" "build-job-123" "$TEXT"

# Test: send missing content returns error
RAW=$(call_tool "document" '{"action":"send","to":"claude-code"}')
ERR=$(is_error "$RAW")
assert "send(no content) is error" "true" "$ERR"

# Test: receive messages for claude-code
RAW=$(call_tool "document" '{"action":"receive","to":"claude-code"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "receive(claude-code) not error" "false" "$ERR"
assert_contains "receive(claude-code) has msg from chat" "Hello from Claude Chat" "$TEXT"

# Test: receive messages for claude-chat
RAW=$(call_tool "document" '{"action":"receive","to":"claude-chat"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "receive(claude-chat) not error" "false" "$ERR"
assert_contains "receive(claude-chat) has msg from code" "Hello from Claude Code" "$TEXT"
assert_contains "receive(claude-chat) has status update" "build in progress" "$TEXT"

# Test: ack a message (ephemeral — deleted from Firebase after ack)
RAW=$(call_tool "document" '{"action":"ack","docId":"'"$MSG1_ID"'"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "ack(msg1) not error" "false" "$ERR"
assert_contains "ack(msg1) status=delivered" "delivered" "$TEXT"
assert_contains "ack(msg1) _deleted=true" "_deleted" "$TEXT"

# Test: ack already acked returns error (message was deleted from Firebase)
RAW=$(call_tool "document" '{"action":"ack","docId":"'"$MSG1_ID"'"}')
ERR=$(is_error "$RAW")
assert "ack(already acked) is error" "true" "$ERR"

# Test: receive after ack — msg1 no longer in pending
RAW=$(call_tool "document" '{"action":"receive","to":"claude-code"}')
TEXT=$(get_text "$RAW")
assert_not_contains "receive(after ack) msg1 gone" "Hello from Claude Chat" "$TEXT"

# Test: ack missing docId returns error
RAW=$(call_tool "document" '{"action":"ack"}')
ERR=$(is_error "$RAW")
assert "ack(no docId) is error" "true" "$ERR"

# Test: ack non-message returns error (use a spec doc from earlier tests)
RAW=$(call_tool "document" '{"action":"ack","docId":"'"$DOC1_ID"'"}')
ERR=$(is_error "$RAW")
assert "ack(non-message) is error" "true" "$ERR"

# Clean up remaining test messages (ephemeral — these get deleted on ack)
call_tool "document" '{"action":"ack","docId":"'"$MSG2_ID"'"}' > /dev/null
call_tool "document" '{"action":"ack","docId":"'"$MSG3_ID"'"}' > /dev/null

echo ""

# ═══════════════════════════════════════════════════════════════
# Phase 13: GitHub Delivery (error paths + auto-delivery with token)
# ═══════════════════════════════════════════════════════════════
echo "── Phase 13: GitHub Delivery ─────────────────────────────────"

# Test: deliver-to-github with nonexistent docId → error
RAW=$(call_tool "document" '{"action":"deliver-to-github","docId":"nonexistent-doc-id"}')
ERR=$(is_error "$RAW")
assert "deliver-to-github(nonexistent) is error" "true" "$ERR"

# Test: deliver-to-github missing docId → error
RAW=$(call_tool "document" '{"action":"deliver-to-github"}')
ERR=$(is_error "$RAW")
assert "deliver-to-github(no docId) is error" "true" "$ERR"

# Test: deliver-to-github on already-delivered doc → error
RAW=$(call_tool "document" '{"action":"push","type":"spec","appId":"command-center","content":"test spec for delivery","targetPath":"specs/test.md"}')
TEXT=$(get_text "$RAW")
GH_TEST_DOC_ID=$(echo "$TEXT" | python3 -c "
import json,sys
try:
    d=json.loads(sys.stdin.read())
    print(d.get('id',''))
except:
    print('')
" 2>/dev/null)
call_tool "document" '{"action":"deliver","docId":"'"$GH_TEST_DOC_ID"'"}' > /dev/null
RAW=$(call_tool "document" '{"action":"deliver-to-github","docId":"'"$GH_TEST_DOC_ID"'"}')
ERR=$(is_error "$RAW")
assert "deliver-to-github(already delivered) is error" "true" "$ERR"

# Test: push with autoDeliver=true → doc status reflects delivery attempt
# (delivered if repos.prod configured, failed if not, pending if no token)
RAW=$(call_tool "document" '{"action":"push","type":"spec","appId":"command-center","content":"auto test","targetPath":"specs/auto.md","autoDeliver":true}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
AUTO_DOC_STATUS=$(echo "$TEXT" | python3 -c "
import json,sys
try:
    d=json.loads(sys.stdin.read())
    print(d.get('status',''))
except:
    print('')
" 2>/dev/null)
assert "push(autoDeliver) not error" "false" "$ERR"
# With GITHUB_TOKEN set and repos.prod configured, status should be delivered or failed (not pending)
assert "push(autoDeliver) attempted delivery" "True" "$([ "$AUTO_DOC_STATUS" = 'delivered' ] || [ "$AUTO_DOC_STATUS" = 'failed' ] && echo True || echo False)"

# Clean up the auto-deliver test doc if still pending
AUTO_DOC_ID=$(echo "$TEXT" | python3 -c "
import json,sys
try:
    d=json.loads(sys.stdin.read())
    print(d.get('id',''))
except:
    print('')
" 2>/dev/null)

# ═══════════════════════════════════════════════════════════════
# Phase 13b: Document Lifecycle — Purge & Lifespan
# ═══════════════════════════════════════════════════════════════
echo "── Phase 13b: Document Lifecycle — Purge & Lifespan ─────────"

# Test: purge action exists and runs (may purge 0 docs since test data is fresh)
RAW=$(call_tool "document" '{"action":"purge"}')
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "document(purge) not error" "false" "$ERR"
assert_contains "document(purge) has purged count" "purged" "$TEXT"

# Test: verify lifespan field on claude-md docs (should be permanent)
RAW=$(call_tool "document" "{\"action\":\"get\",\"docId\":\"$PUSHED_DOC_ID\"}")
TEXT=$(get_text "$RAW")
# PUSHED_DOC_ID may have been delivered via GitHub and is permanent, so should still exist
if [ "$(is_error "$RAW")" = "false" ]; then
  PUSHED_LIFESPAN=$(jq_field "$TEXT" "['lifespan']")
  assert "claude-md doc lifespan=permanent" "permanent" "$PUSHED_LIFESPAN"
else
  # If doc was deleted by deliver-to-github (shouldn't happen for permanent), skip
  echo "  ⚠️  PUSHED_DOC_ID not found (may have been auto-cleaned)"
fi

# Test: deliver ephemeral doc → verify it gets deleted
RAW=$(call_tool "document" '{"action":"push","type":"spec","appId":"command-center","content":"# Ephemeral test","targetPath":"specs/ephemeral.md","lifespan":"ephemeral"}')
TEXT=$(get_text "$RAW")
EPHEMERAL_DOC_ID=$(jq_field "$TEXT" "['id']")
EPHEMERAL_LIFESPAN=$(jq_field "$TEXT" "['lifespan']")
assert "ephemeral doc lifespan=ephemeral" "ephemeral" "$EPHEMERAL_LIFESPAN"

RAW=$(call_tool "document" "{\"action\":\"deliver\",\"docId\":\"$EPHEMERAL_DOC_ID\"}")
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "deliver(ephemeral) not error" "false" "$ERR"
assert_contains "deliver(ephemeral) _deleted=true" "_deleted" "$TEXT"

# Verify ephemeral doc was actually deleted from Firebase
RAW=$(call_tool "document" "{\"action\":\"get\",\"docId\":\"$EPHEMERAL_DOC_ID\"}")
ERR=$(is_error "$RAW")
assert "ephemeral doc deleted after deliver" "true" "$ERR"

echo ""

# ═══════════════════════════════════════════════════════════════
# Phase 14: Cleanup — deliver test-generated documents
# ═══════════════════════════════════════════════════════════════
echo "── Phase 14: Cleanup ───────────────────────────────────────"

# Deliver the pushed CLAUDE.md doc from Phase 10 (permanent lifespan — still exists)
if [ -n "$PUSHED_DOC_ID" ]; then
  call_tool "document" '{"action":"deliver","docId":"'"$PUSHED_DOC_ID"'","deliveredBy":"e2e-cleanup"}' > /dev/null 2>&1
  echo "  Cleaned up pushed CLAUDE.md doc: $PUSHED_DOC_ID"
fi

# Deliver the permanent spec doc from Phase 8
if [ -n "$DOC_PERM_ID" ]; then
  call_tool "document" '{"action":"deliver","docId":"'"$DOC_PERM_ID"'","deliveredBy":"e2e-cleanup"}' > /dev/null 2>&1
  echo "  Cleaned up permanent spec doc: $DOC_PERM_ID"
fi

# Note: Ephemeral messages (MSG1, MSG2, MSG3) were auto-deleted on ack
# Note: Ephemeral docs were auto-deleted on deliver
# Non-ephemeral docs (DOC1, DOC2 — short lifespan) still exist after deliver

# Deliver any remaining pending docs from this or prior test runs
RAW=$(call_tool "document" '{"action":"list","appId":"command-center","status":"pending"}')
TEXT=$(get_text "$RAW")
PENDING_IDS=$(echo "$TEXT" | python3 -c "
import json,sys
try:
    d = json.loads(sys.stdin.read())
    docs = d.get('items', d) if isinstance(d, dict) else d
    for doc in docs:
        if doc.get('status') == 'pending':
            print(doc['id'])
except:
    pass
" 2>/dev/null)

CLEANUP_COUNT=0
while IFS= read -r pid; do
  if [ -n "$pid" ]; then
    call_tool "document" '{"action":"deliver","docId":"'"$pid"'","deliveredBy":"e2e-cleanup"}' > /dev/null 2>&1
    CLEANUP_COUNT=$((CLEANUP_COUNT + 1))
  fi
done <<< "$PENDING_IDS"

# Run purge to clean up old delivered/failed docs
call_tool "document" '{"action":"purge"}' > /dev/null 2>&1

if [ "$CLEANUP_COUNT" -gt 0 ]; then
  echo "  Cleaned up $CLEANUP_COUNT additional pending test docs"
else
  echo "  No additional pending test docs to clean up"
fi

# ═══════════════════════════════════════════════════════════════
# Phase 15: Job as Universal Work Order (draft/claim/revise)
# ═══════════════════════════════════════════════════════════════
echo "── Phase 15: Job as Universal Work Order ────────────────────"

# Use a unique test appId so Phase 15 doesn't conflict with real active jobs
P15_APP_ID="e2e-test-work-order-$$"

# Cleanup: complete any leftover active E2E test jobs from previous runs
RAW=$(call_tool "job" "{\"action\":\"list\",\"status\":\"active\",\"appId\":\"command-center\"}")
TEXT=$(get_text "$RAW")
echo "$TEXT" | python3 -c "
import json,sys
d = json.loads(sys.stdin.read())
jobs = d['items']
for j in jobs:
    if 'E2E' in j.get('title',''):
        print(j['id'])
" | while read -r orphan_id; do
  call_tool "job" "{\"action\":\"complete\",\"jobId\":\"$orphan_id\",\"status\":\"abandoned\",\"summary\":\"E2E cleanup of orphaned test job\"}" > /dev/null
  echo "  Cleaned up orphaned active job: $orphan_id"
done

# Test 1: Create draft job with instructions and attachments (createdBy=claude-chat → draft)
RAW=$(call_tool "job" "{\"action\":\"start\",\"appId\":\"$P15_APP_ID\",\"title\":\"E2E Draft Job - Work Order\",\"createdBy\":\"claude-chat\",\"jobType\":\"build\",\"instructions\":\"Build the widget feature. See attached CLAUDE.md for details.\",\"attachments\":\"[{\\\"type\\\":\\\"claude-md\\\",\\\"label\\\":\\\"CLAUDE.md\\\",\\\"content\\\":\\\"# Test CLAUDE.md\\\\nBuild the widget.\\\",\\\"targetPath\\\":\\\"CLAUDE.md\\\",\\\"action\\\":\\\"write\\\"},{\\\"type\\\":\\\"context\\\",\\\"label\\\":\\\"Current state\\\",\\\"content\\\":\\\"No widget exists yet.\\\",\\\"action\\\":\\\"reference\\\"}]\",\"conceptSnapshot\":\"{\\\"rules\\\":[\\\"E2E rule 1\\\"],\\\"constraints\\\":[\\\"E2E constraint 1\\\"],\\\"decisions\\\":[\\\"E2E decision 1\\\"],\\\"opens\\\":[\\\"E2E open 1\\\"]}\"}")
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
DRAFT_JOB_ID=$(jq_field "$TEXT" "['id']")
DRAFT_STATUS=$(jq_field "$TEXT" "['status']")
DRAFT_JOB_TYPE=$(jq_field "$TEXT" "['jobType']")
DRAFT_CREATED_BY=$(jq_field "$TEXT" "['createdBy']")
DRAFT_INSTRUCTIONS=$(jq_field "$TEXT" "['instructions']")
DRAFT_ATTACH_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('attachments',[])))")
DRAFT_SNAPSHOT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print('True' if d.get('conceptSnapshot') else 'False')")
DRAFT_STARTED_AT=$(jq_field "$TEXT" "['startedAt']")
DRAFT_CREATED_AT=$(jq_field "$TEXT" "['createdAt']")
assert "draft job not error" "false" "$ERR"
assert_not_empty "draft job has id" "$DRAFT_JOB_ID"
assert "draft job status=draft" "draft" "$DRAFT_STATUS"
assert "draft job jobType=build" "build" "$DRAFT_JOB_TYPE"
assert "draft job createdBy=claude-chat" "claude-chat" "$DRAFT_CREATED_BY"
assert_contains "draft job has instructions" "widget" "$DRAFT_INSTRUCTIONS"
assert "draft job has 2 attachments" "2" "$DRAFT_ATTACH_COUNT"
assert "draft job has conceptSnapshot" "True" "$DRAFT_SNAPSHOT"
assert "draft job startedAt is null" "None" "$DRAFT_STARTED_AT"
assert_not_empty "draft job has createdAt" "$DRAFT_CREATED_AT"

# Test 2: List draft jobs (verify filtering works)
RAW=$(call_tool "job" "{\"action\":\"list\",\"status\":\"draft\",\"appId\":\"$P15_APP_ID\"}")
TEXT=$(get_text "$RAW")
DRAFT_LIST_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len([j for j in d['items'] if j['status']=='draft']))")
assert "list(status=draft) has drafts" "true" "$([ "$DRAFT_LIST_COUNT" -ge 1 ] && echo true || echo false)"
assert_contains "list(status=draft) contains our draft" "$DRAFT_JOB_ID" "$TEXT"

# Test 2b: List with createdBy filter
RAW=$(call_tool "job" '{"action":"list","createdBy":"claude-chat"}')
TEXT=$(get_text "$RAW")
assert_contains "list(createdBy=claude-chat) has our draft" "$DRAFT_JOB_ID" "$TEXT"

# Test 2c: List with jobType filter
RAW=$(call_tool "job" '{"action":"list","jobType":"build"}')
TEXT=$(get_text "$RAW")
assert_contains "list(jobType=build) has our draft" "$DRAFT_JOB_ID" "$TEXT"

# Test 3: Claim the draft job (draft → active)
RAW=$(call_tool "job" "{\"action\":\"claim\",\"jobId\":\"$DRAFT_JOB_ID\"}")
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
CLAIMED_STATUS=$(jq_field "$TEXT" "['status']")
CLAIMED_AT=$(jq_field "$TEXT" "['claimedAt']")
CLAIMED_BY=$(jq_field "$TEXT" "['claimedBy']")
CLAIMED_STARTED=$(jq_field "$TEXT" "['startedAt']")
assert "claim not error" "false" "$ERR"
assert "claim status=active" "active" "$CLAIMED_STATUS"
assert_not_empty "claim has claimedAt" "$CLAIMED_AT"
assert "claim claimedBy=claude-code" "claude-code" "$CLAIMED_BY"
assert_not_empty "claim sets startedAt" "$CLAIMED_STARTED"

# Test 3b: Claim again should fail (already active)
RAW=$(call_tool "job" "{\"action\":\"claim\",\"jobId\":\"$DRAFT_JOB_ID\"}")
ERR=$(is_error "$RAW")
assert "claim(already active) is error" "true" "$ERR"

# Test 4: Claim blocked by existing active build for same app
# Create another draft for same app
RAW=$(call_tool "job" "{\"action\":\"start\",\"appId\":\"$P15_APP_ID\",\"title\":\"E2E Second Draft\",\"createdBy\":\"claude-chat\",\"jobType\":\"build\"}")
TEXT=$(get_text "$RAW")
DRAFT2_JOB_ID=$(jq_field "$TEXT" "['id']")

# Try to claim — should fail because DRAFT_JOB_ID is active build for command-center
RAW=$(call_tool "job" "{\"action\":\"claim\",\"jobId\":\"$DRAFT2_JOB_ID\"}")
ERR=$(is_error "$RAW")
assert "claim blocked by active build" "true" "$ERR"
assert_contains "claim blocked mentions active build" "active build" "$(get_text "$RAW")"

# Test 4b: Non-build job can be claimed even with active build
RAW=$(call_tool "job" "{\"action\":\"start\",\"appId\":\"$P15_APP_ID\",\"title\":\"E2E Maintenance Draft\",\"createdBy\":\"claude-chat\",\"jobType\":\"maintenance\"}")
TEXT=$(get_text "$RAW")
MAINT_JOB_ID=$(jq_field "$TEXT" "['id']")

RAW=$(call_tool "job" "{\"action\":\"claim\",\"jobId\":\"$MAINT_JOB_ID\"}")
ERR=$(is_error "$RAW")
MAINT_STATUS=$(jq_field "$(get_text "$RAW")" "['status']")
assert "maintenance claim not error" "false" "$ERR"
assert "maintenance claim status=active" "active" "$MAINT_STATUS"

# Test 5: Review then revise back to draft
# First review the claimed job
RAW=$(call_tool "job" "{\"action\":\"review\",\"jobId\":\"$DRAFT_JOB_ID\",\"concerns\":[\"E2E: Missing test plan\",\"E2E: Unclear scope\"]}")
TEXT=$(get_text "$RAW")
REVIEW_STATUS=$(jq_field "$TEXT" "['status']")
assert "review for revise status=review" "review" "$REVIEW_STATUS"

# Now revise back to draft
RAW=$(call_tool "job" "{\"action\":\"revise\",\"jobId\":\"$DRAFT_JOB_ID\"}")
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
REVISE_STATUS=$(jq_field "$TEXT" "['status']")
assert "revise not error" "false" "$ERR"
assert "revise status=draft" "draft" "$REVISE_STATUS"

# Test 5b: Revise from non-review status should fail
RAW=$(call_tool "job" "{\"action\":\"revise\",\"jobId\":\"$DRAFT_JOB_ID\"}")
ERR=$(is_error "$RAW")
assert "revise(draft) is error" "true" "$ERR"

# Test 6: Update instructions/attachments on draft (should succeed)
RAW=$(call_tool "job" "{\"action\":\"update\",\"jobId\":\"$DRAFT_JOB_ID\",\"instructions\":\"REVISED: Build the widget feature with tests.\"}")
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "update instructions on draft not error" "false" "$ERR"
assert_contains "update instructions on draft has new text" "REVISED" "$TEXT"

RAW=$(call_tool "job" "{\"action\":\"update\",\"jobId\":\"$DRAFT_JOB_ID\",\"attachments\":\"[{\\\"type\\\":\\\"spec\\\",\\\"label\\\":\\\"Updated spec\\\",\\\"content\\\":\\\"New spec content\\\",\\\"targetPath\\\":\\\"specs/widget.md\\\",\\\"action\\\":\\\"write\\\"}]\"}")
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
UPDATED_ATTACH_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('attachments',[])))")
assert "update attachments on draft not error" "false" "$ERR"
assert "update attachments replaces array" "1" "$UPDATED_ATTACH_COUNT"

# Test 7: Update instructions/attachments on active job (should fail)
# First claim the draft again (it was revise back to draft, and the active build was completed via review→revise→draft, so no active build conflict now)
RAW=$(call_tool "job" "{\"action\":\"claim\",\"jobId\":\"$DRAFT_JOB_ID\"}")
ERR=$(is_error "$RAW")
assert "re-claim after revise not error" "false" "$ERR"

RAW=$(call_tool "job" "{\"action\":\"update\",\"jobId\":\"$DRAFT_JOB_ID\",\"instructions\":\"Should fail — job is active\"}")
ERR=$(is_error "$RAW")
assert "update instructions on active is error" "true" "$ERR"

RAW=$(call_tool "job" "{\"action\":\"update\",\"jobId\":\"$DRAFT_JOB_ID\",\"attachments\":\"[]\"}")
ERR=$(is_error "$RAW")
assert "update attachments on active is error" "true" "$ERR"

# Test 8: Add question/answer events
RAW=$(call_tool "job" "{\"action\":\"add_event\",\"jobId\":\"$DRAFT_JOB_ID\",\"eventType\":\"question\",\"detail\":\"E2E: Should the widget support dark mode?\"}")
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "add_event(question) not error" "false" "$ERR"
assert_contains "add_event(question) type" "question" "$TEXT"

RAW=$(call_tool "job" "{\"action\":\"add_event\",\"jobId\":\"$DRAFT_JOB_ID\",\"eventType\":\"answer\",\"detail\":\"E2E: Yes, use existing theme system\"}")
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
assert "add_event(answer) not error" "false" "$ERR"
assert_contains "add_event(answer) type" "answer" "$TEXT"

# Verify events on job
RAW=$(call_tool "job" "{\"action\":\"get\",\"jobId\":\"$DRAFT_JOB_ID\"}")
TEXT=$(get_text "$RAW")
Q_EVENTS=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len([e for e in d.get('events',[]) if e.get('type') in ('question','answer')]))")
assert "job has 2 question/answer events" "2" "$Q_EVENTS"

# Test 9: Backward compat — start without new fields (existing flow, status=active)
RAW=$(call_tool "job" "{\"action\":\"start\",\"appId\":\"$P15_APP_ID\",\"title\":\"E2E Backward Compat Job\"}")
TEXT=$(get_text "$RAW")
BC_STATUS=$(jq_field "$TEXT" "['status']")
BC_JOB_TYPE=$(jq_field "$TEXT" "['jobType']")
BC_CREATED_BY=$(jq_field "$TEXT" "['createdBy']")
BC_STARTED_AT=$(jq_field "$TEXT" "['startedAt']")
BC_JOB_ID=$(jq_field "$TEXT" "['id']")
assert "backward compat status=active" "active" "$BC_STATUS"
assert "backward compat jobType=build" "build" "$BC_JOB_TYPE"
assert "backward compat createdBy=claude-code" "claude-code" "$BC_CREATED_BY"
assert_not_empty "backward compat has startedAt" "$BC_STARTED_AT"

# Test 10: Full lifecycle — draft → claim → active → events → complete
RAW=$(call_tool "job" "{\"action\":\"complete\",\"jobId\":\"$DRAFT_JOB_ID\",\"status\":\"completed\",\"summary\":\"E2E: Full draft lifecycle test complete\",\"testsRun\":5,\"testsPassed\":5,\"testsFailed\":0,\"buildSuccess\":true}")
TEXT=$(get_text "$RAW")
ERR=$(is_error "$RAW")
FINAL_STATUS=$(jq_field "$TEXT" "['status']")
assert "full lifecycle complete not error" "false" "$ERR"
assert "full lifecycle status=completed" "completed" "$FINAL_STATUS"

# Test 10b: Verify the completed job has all fields preserved
RAW=$(call_tool "job" "{\"action\":\"get\",\"jobId\":\"$DRAFT_JOB_ID\"}")
TEXT=$(get_text "$RAW")
FINAL_INSTRUCTIONS=$(jq_field "$TEXT" "['instructions']")
FINAL_CLAIMED_BY=$(jq_field "$TEXT" "['claimedBy']")
FINAL_JOB_TYPE=$(jq_field "$TEXT" "['jobType']")
FINAL_SNAPSHOT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print('True' if d.get('conceptSnapshot') else 'False')")
assert_contains "completed job preserved instructions" "REVISED" "$FINAL_INSTRUCTIONS"
assert "completed job preserved claimedBy" "claude-code" "$FINAL_CLAIMED_BY"
assert "completed job preserved jobType" "build" "$FINAL_JOB_TYPE"
assert "completed job preserved conceptSnapshot" "True" "$FINAL_SNAPSHOT"

# Test: Invalid attachments JSON
RAW=$(call_tool "job" '{"action":"start","appId":"command-center","title":"bad attach","createdBy":"claude-chat","attachments":"not-json"}')
ERR=$(is_error "$RAW")
assert "start with invalid attachments JSON is error" "true" "$ERR"

# Test: Invalid conceptSnapshot JSON
RAW=$(call_tool "job" '{"action":"start","appId":"command-center","title":"bad snapshot","createdBy":"claude-chat","conceptSnapshot":"not-json"}')
ERR=$(is_error "$RAW")
assert "start with invalid conceptSnapshot JSON is error" "true" "$ERR"

# Test: Revise missing jobId
RAW=$(call_tool "job" '{"action":"revise"}')
ERR=$(is_error "$RAW")
assert "revise missing jobId is error" "true" "$ERR"

# Test: Claim missing jobId
RAW=$(call_tool "job" '{"action":"claim"}')
ERR=$(is_error "$RAW")
assert "claim missing jobId is error" "true" "$ERR"

# ═══════════════════════════════════════════════════════════════
# SESSION STATE MACHINE — New fields, preferences, context estimate
# ═══════════════════════════════════════════════════════════════
echo ""
echo "────────── Session State Machine Tests ──────────"

# Test: session start with state machine fields
SM_ARGS=$(python3 -c "import json; print(json.dumps({'action':'start','ideaId':'$IDEA2_ID','appId':'command-center','title':'E2E State Machine Session','mode':'ideation','sessionGoal':'Test state machine fields','presentationMode':'cli','targetOpens':['open1','open2'],'configSnapshot':json.dumps({'mode':'ideation','lens':None})}))")
RAW=$(call_tool "session" "$SM_ARGS")
TEXT=$(get_text "$RAW")
SM_SESSION_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "session(start+sm) returns id" "$SM_SESSION_ID"
assert "session(start+sm) mode=ideation" "ideation" "$(jq_field "$TEXT" "['mode']")"
assert "session(start+sm) sessionGoal" "Test state machine fields" "$(jq_field "$TEXT" "['sessionGoal']")"
assert "session(start+sm) presentationMode=cli" "cli" "$(jq_field "$TEXT" "['presentationMode']")"
assert "session(start+sm) contextEstimate=0" "0" "$(jq_field "$TEXT" "['contextEstimate']")"
assert "session(start+sm) conceptBlockCount=0" "0" "$(jq_field "$TEXT" "['conceptBlockCount']")"
assert_not_empty "session(start+sm) has lastActivityAt" "$(jq_field "$TEXT" "['lastActivityAt']")"
# Verify targetOpens is an array with 2 items
TARGET_OPENS_LEN=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('targetOpens',[])))")
assert "session(start+sm) targetOpens has 2 items" "2" "$TARGET_OPENS_LEN"
# Verify configSnapshot was parsed from JSON string to object
CONFIG_SNAP=$(echo "$TEXT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); cs=d.get('configSnapshot',{}); print(cs.get('mode','') if isinstance(cs,dict) else '')")
assert "session(start+sm) configSnapshot.mode parsed" "ideation" "$CONFIG_SNAP"

# Test: session update with state machine fields
RAW=$(call_tool "session" "{\"action\":\"update\",\"sessionId\":\"$SM_SESSION_ID\",\"mode\":\"build-review\",\"activeLens\":\"technical\",\"conceptBlockCount\":5,\"activeIdeaId\":\"$IDEA2_ID\",\"activeAppId\":\"command-center\"}")
TEXT=$(get_text "$RAW")
assert "session(update+sm) mode=build-review" "build-review" "$(jq_field "$TEXT" "['mode']")"
assert "session(update+sm) activeLens=technical" "technical" "$(jq_field "$TEXT" "['activeLens']")"
assert "session(update+sm) conceptBlockCount=5" "5" "$(jq_field "$TEXT" "['conceptBlockCount']")"
assert_not_empty "session(update+sm) lastActivityAt updated" "$(jq_field "$TEXT" "['lastActivityAt']")"

# Test: session update contextEstimate manually
RAW=$(call_tool "session" "{\"action\":\"update\",\"sessionId\":\"$SM_SESSION_ID\",\"contextEstimate\":15000}")
TEXT=$(get_text "$RAW")
assert "session(update+sm) contextEstimate=15000" "15000" "$(jq_field "$TEXT" "['contextEstimate']")"

# Test: session get verifies all state machine fields persisted
RAW=$(call_tool "session" "{\"action\":\"get\",\"sessionId\":\"$SM_SESSION_ID\"}")
TEXT=$(get_text "$RAW")
assert "session(get+sm) mode persisted" "build-review" "$(jq_field "$TEXT" "['mode']")"
assert "session(get+sm) activeLens persisted" "technical" "$(jq_field "$TEXT" "['activeLens']")"
assert "session(get+sm) conceptBlockCount persisted" "5" "$(jq_field "$TEXT" "['conceptBlockCount']")"
# contextEstimate may be > 15000 due to auto-increment from tool responses
CTX_EST_VAL=$(jq_field "$TEXT" "['contextEstimate']")
CTX_GTE=$(python3 -c "print('true' if int('${CTX_EST_VAL}' or '0') >= 15000 else 'false')")
assert "session(get+sm) contextEstimate >= 15000" "true" "$CTX_GTE"
assert "session(get+sm) presentationMode persisted" "cli" "$(jq_field "$TEXT" "['presentationMode']")"
assert "session(get+sm) sessionGoal persisted" "Test state machine fields" "$(jq_field "$TEXT" "['sessionGoal']")"

# Test: session complete with closing fields
RAW=$(call_tool "session" "{\"action\":\"complete\",\"sessionId\":\"$SM_SESSION_ID\",\"summary\":\"State machine E2E test done\",\"closingSummary\":\"Tested all state machine fields\",\"nextSessionRecommendation\":\"Test context auto-increment\",\"conceptsResolved\":3}")
TEXT=$(get_text "$RAW")
assert "session(complete+sm) status=completed" "completed" "$(jq_field "$TEXT" "['status']")"
assert "session(complete+sm) closingSummary" "Tested all state machine fields" "$(jq_field "$TEXT" "['closingSummary']")"
assert "session(complete+sm) nextSessionRecommendation" "Test context auto-increment" "$(jq_field "$TEXT" "['nextSessionRecommendation']")"
assert "session(complete+sm) conceptsResolved=3" "3" "$(jq_field "$TEXT" "['conceptsResolved']")"

# Test: session start with defaults (no state machine fields)
RAW=$(call_tool "session" "{\"action\":\"start\",\"ideaId\":\"$IDEA2_ID\",\"title\":\"E2E Defaults Session\"}")
TEXT=$(get_text "$RAW")
DEFAULT_SESSION_ID=$(jq_field "$TEXT" "['id']")
assert "session(start defaults) mode=base" "base" "$(jq_field "$TEXT" "['mode']")"
assert "session(start defaults) presentationMode=interactive" "interactive" "$(jq_field "$TEXT" "['presentationMode']")"
assert "session(start defaults) contextEstimate=0" "0" "$(jq_field "$TEXT" "['contextEstimate']")"
# Cleanup
call_tool "session" "{\"action\":\"complete\",\"sessionId\":\"$DEFAULT_SESSION_ID\",\"summary\":\"defaults test done\"}" > /dev/null

# ─── PREFERENCES ───
echo ""
echo "────────── Preferences Tests ──────────"

# Test: preferences read (default)
RAW=$(call_tool "session" '{"action":"preferences"}')
TEXT=$(get_text "$RAW")
assert "preferences(read) default presentationMode=interactive" "interactive" "$(jq_field "$TEXT" "['presentationMode']")"

# Test: preferences write
RAW=$(call_tool "session" '{"action":"preferences","presentationMode":"cli"}')
TEXT=$(get_text "$RAW")
assert "preferences(write) presentationMode=cli" "cli" "$(jq_field "$TEXT" "['presentationMode']")"

# Test: preferences read back
RAW=$(call_tool "session" '{"action":"preferences"}')
TEXT=$(get_text "$RAW")
assert "preferences(read back) presentationMode=cli" "cli" "$(jq_field "$TEXT" "['presentationMode']")"

# Test: preferences write back to interactive
RAW=$(call_tool "session" '{"action":"preferences","presentationMode":"interactive"}')
TEXT=$(get_text "$RAW")
assert "preferences(restore) presentationMode=interactive" "interactive" "$(jq_field "$TEXT" "['presentationMode']")"

# ─── CONTEXT ESTIMATE AUTO-INCREMENT ───
echo ""
echo "────────── Context Estimate Auto-Increment Tests ──────────"

# Start a session to activate the cache
RAW=$(call_tool "session" "{\"action\":\"start\",\"ideaId\":\"$IDEA2_ID\",\"title\":\"E2E Context Estimate Session\"}")
TEXT=$(get_text "$RAW")
CTX_SESSION_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "ctx session started" "$CTX_SESSION_ID"

# Make some tool calls — each should increment contextEstimate
call_tool "session" "{\"action\":\"get\",\"sessionId\":\"$CTX_SESSION_ID\"}" > /dev/null
sleep 1
call_tool "session" "{\"action\":\"get\",\"sessionId\":\"$CTX_SESSION_ID\"}" > /dev/null
sleep 1

# Check that contextEstimate increased from 0
RAW=$(call_tool "session" "{\"action\":\"get\",\"sessionId\":\"$CTX_SESSION_ID\"}")
TEXT=$(get_text "$RAW")
CTX_EST=$(jq_field "$TEXT" "['contextEstimate']")
CTX_INCREASED=$(python3 -c "print('true' if int('${CTX_EST}' or '0') > 0 else 'false')")
assert "contextEstimate auto-incremented > 0" "true" "$CTX_INCREASED"

# Cleanup
call_tool "session" "{\"action\":\"complete\",\"sessionId\":\"$CTX_SESSION_ID\",\"summary\":\"context estimate test done\"}" > /dev/null

# Cleanup: complete remaining active jobs
call_tool "job" "{\"action\":\"complete\",\"jobId\":\"$MAINT_JOB_ID\",\"status\":\"completed\",\"summary\":\"E2E cleanup\"}" > /dev/null
call_tool "job" "{\"action\":\"complete\",\"jobId\":\"$BC_JOB_ID\",\"status\":\"completed\",\"summary\":\"E2E cleanup\"}" > /dev/null
# DRAFT2 is still in draft status — just leave it (no cleanup needed for drafts)

echo ""

# ═══════════════════════════════════════════════════════════════
echo "── Phase 16: List Limit + Delete Tests ───────────────────"
# ═══════════════════════════════════════════════════════════════
echo ""

# Test: list with limit — sessions
RAW=$(call_tool "session" '{"action":"list","limit":2}')
TEXT=$(get_text "$RAW")
LIMIT_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['items']))")
LIMIT_OK=$(python3 -c "print('true' if int('${LIMIT_COUNT}' or '0') <= 2 else 'false')")
assert "session(list) limit=2 returns ≤2" "true" "$LIMIT_OK"

# Test: list with limit — ideas
RAW=$(call_tool "idea" '{"action":"list","limit":1}')
TEXT=$(get_text "$RAW")
LIMIT_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['items']))")
assert "idea(list) limit=1 returns 1" "1" "$LIMIT_COUNT"

# Test: list with limit — jobs
RAW=$(call_tool "job" '{"action":"list","limit":1}')
TEXT=$(get_text "$RAW")
LIMIT_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['items']))")
assert "job(list) limit=1 returns 1" "1" "$LIMIT_COUNT"

# Test: list with limit — list_concepts
RAW=$(call_tool "list_concepts" '{"limit":1}')
TEXT=$(get_text "$RAW")
LIMIT_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['items']))")
assert "list_concepts limit=1 returns 1" "1" "$LIMIT_COUNT"

# Test: delete — create a throwaway concept, then delete it
RAW=$(call_tool "concept" "{\"action\":\"create\",\"type\":\"OPEN\",\"content\":\"E2E delete test concept\",\"ideaOrigin\":\"$IDEA2_ID\"}")
TEXT=$(get_text "$RAW")
DEL_CONCEPT_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "concept(create) for delete test" "$DEL_CONCEPT_ID"

RAW=$(call_tool "concept" "{\"action\":\"delete\",\"conceptId\":\"$DEL_CONCEPT_ID\"}")
TEXT=$(get_text "$RAW")
assert "concept(delete) success" "$DEL_CONCEPT_ID" "$(jq_field "$TEXT" "['deleted']")"

# Verify it's actually gone
RAW=$(call_tool "concept" "{\"action\":\"update\",\"conceptId\":\"$DEL_CONCEPT_ID\",\"content\":\"should fail\"}")
ERR=$(is_error "$RAW")
assert "concept(delete) verify gone" "true" "$ERR"

# Test: delete — create a throwaway session, then delete it
RAW=$(call_tool "session" "{\"action\":\"start\",\"ideaId\":\"$IDEA2_ID\",\"title\":\"E2E delete test session\"}")
TEXT=$(get_text "$RAW")
DEL_SESSION_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "session(start) for delete test" "$DEL_SESSION_ID"

RAW=$(call_tool "session" "{\"action\":\"delete\",\"sessionId\":\"$DEL_SESSION_ID\"}")
TEXT=$(get_text "$RAW")
assert "session(delete) success" "$DEL_SESSION_ID" "$(jq_field "$TEXT" "['deleted']")"

# Test: delete not found
RAW=$(call_tool "session" '{"action":"delete","sessionId":"nonexistent-id"}')
ERR=$(is_error "$RAW")
assert "session(delete) not found is error" "true" "$ERR"

# Test: delete job
RAW=$(call_tool "job" "{\"action\":\"start\",\"appId\":\"e2e-delete-test\",\"title\":\"E2E delete test job\"}")
TEXT=$(get_text "$RAW")
DEL_JOB_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "job(start) for delete test" "$DEL_JOB_ID"

RAW=$(call_tool "job" "{\"action\":\"delete\",\"jobId\":\"$DEL_JOB_ID\"}")
TEXT=$(get_text "$RAW")
assert "job(delete) success" "$DEL_JOB_ID" "$(jq_field "$TEXT" "['deleted']")"

# Test: delete idea (with appIdeas index cleanup)
RAW=$(call_tool "idea" '{"action":"create","name":"E2E Delete Test Idea","description":"will be deleted"}')
TEXT=$(get_text "$RAW")
DEL_IDEA_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "idea(create) for delete test" "$DEL_IDEA_ID"

RAW=$(call_tool "idea" "{\"action\":\"delete\",\"ideaId\":\"$DEL_IDEA_ID\"}")
TEXT=$(get_text "$RAW")
assert "idea(delete) success" "$DEL_IDEA_ID" "$(jq_field "$TEXT" "['deleted']")"

echo ""

# ═══════════════════════════════════════════════════════════════
echo "── Phase 17: Concept Lifecycle — Built, Migrate, Job Signals ─"
# ═══════════════════════════════════════════════════════════════
echo ""

# -- mark_built: create a DECISION, mark it built --
RAW=$(call_tool "concept" "{\"action\":\"create\",\"type\":\"DECISION\",\"content\":\"E2E lifecycle: decision to be built\",\"ideaOrigin\":\"$IDEA2_ID\"}")
TEXT=$(get_text "$RAW")
BUILT_CONCEPT_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "concept(create) DECISION for built test" "$BUILT_CONCEPT_ID"

RAW=$(call_tool "concept" "{\"action\":\"mark_built\",\"conceptId\":\"$BUILT_CONCEPT_ID\"}")
TEXT=$(get_text "$RAW")
BUILT_STATUS=$(jq_field "$TEXT" "['status']")
assert "concept(mark_built) status=built" "built" "$BUILT_STATUS"

# -- mark_built: fails on non-DECISION --
RAW=$(call_tool "concept" "{\"action\":\"create\",\"type\":\"RULE\",\"content\":\"E2E lifecycle: rule cannot be built\",\"ideaOrigin\":\"$IDEA2_ID\"}")
TEXT=$(get_text "$RAW")
RULE_CONCEPT_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "concept(create) RULE for built-fail test" "$RULE_CONCEPT_ID"

RAW=$(call_tool "concept" "{\"action\":\"mark_built\",\"conceptId\":\"$RULE_CONCEPT_ID\"}")
ERR=$(is_error "$RAW")
assert "concept(mark_built) fails on RULE" "true" "$ERR"

# -- mark_built: fails on non-active --
RAW=$(call_tool "concept" "{\"action\":\"mark_built\",\"conceptId\":\"$BUILT_CONCEPT_ID\"}")
ERR=$(is_error "$RAW")
assert "concept(mark_built) fails on already-built" "true" "$ERR"

# -- migrate: create a concept, migrate to different idea --
RAW=$(call_tool "concept" "{\"action\":\"create\",\"type\":\"OPEN\",\"content\":\"E2E lifecycle: open to migrate\",\"ideaOrigin\":\"$IDEA1_ID\"}")
TEXT=$(get_text "$RAW")
MIGRATE_CONCEPT_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "concept(create) for migrate test" "$MIGRATE_CONCEPT_ID"

RAW=$(call_tool "concept" "{\"action\":\"migrate\",\"conceptId\":\"$MIGRATE_CONCEPT_ID\",\"newIdeaId\":\"$IDEA2_ID\"}")
TEXT=$(get_text "$RAW")
NEW_ORIGIN=$(jq_field "$TEXT" "['ideaOrigin']")
assert "concept(migrate) ideaOrigin changed" "$IDEA2_ID" "$NEW_ORIGIN"

OLD_ORIGIN=$(jq_field "$TEXT" "['migratedFrom']")
assert "concept(migrate) reports migratedFrom" "$IDEA1_ID" "$OLD_ORIGIN"

# -- migrate: fails on non-active --
RAW=$(call_tool "concept" "{\"action\":\"migrate\",\"conceptId\":\"$BUILT_CONCEPT_ID\",\"newIdeaId\":\"$IDEA1_ID\"}")
ERR=$(is_error "$RAW")
assert "concept(migrate) fails on built concept" "true" "$ERR"

# -- Job complete auto-builds addressed DECISIONs --
# Create a DECISION, create a job, address the concept, complete the job
RAW=$(call_tool "concept" "{\"action\":\"create\",\"type\":\"DECISION\",\"content\":\"E2E lifecycle: auto-built via job\",\"ideaOrigin\":\"$IDEA2_ID\"}")
TEXT=$(get_text "$RAW")
AUTO_BUILT_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "concept(create) DECISION for auto-built test" "$AUTO_BUILT_ID"

RAW=$(call_tool "job" "{\"action\":\"start\",\"appId\":\"e2e-test-lifecycle\",\"title\":\"E2E lifecycle test job\",\"ideaId\":\"$IDEA2_ID\"}")
TEXT=$(get_text "$RAW")
LIFECYCLE_JOB_ID=$(jq_field "$TEXT" "['id']")
assert_not_empty "job(start) for lifecycle test" "$LIFECYCLE_JOB_ID"

RAW=$(call_tool "job" "{\"action\":\"complete\",\"jobId\":\"$LIFECYCLE_JOB_ID\",\"status\":\"completed\",\"summary\":\"E2E lifecycle complete\",\"conceptsAddressed\":[\"$AUTO_BUILT_ID\"]}")
TEXT=$(get_text "$RAW")
COMPLETED_STATUS=$(jq_field "$TEXT" "['status']")
assert "job(complete) status=completed" "completed" "$COMPLETED_STATUS"

# Verify: conceptsBuilt in response
CONCEPTS_BUILT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('conceptsBuilt',[])))")
BUILT_CONTAINS=$(echo "$CONCEPTS_BUILT" | python3 -c "import json,sys; ids=json.load(sys.stdin); print('true' if '$AUTO_BUILT_ID' in ids else 'false')")
assert "job(complete) conceptsBuilt contains addressed DECISION" "true" "$BUILT_CONTAINS"

# Verify: idea signal in response
IDEA_SIGNAL=$(echo "$TEXT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('ideaSignal')))")
HAS_SIGNAL=$(python3 -c "print('true' if '$IDEA_SIGNAL' != 'null' else 'false')")
assert "job(complete) has ideaSignal" "true" "$HAS_SIGNAL"

# Verify: the DECISION concept is now status=built in Firebase
RAW=$(call_tool "concept" "{\"action\":\"update\",\"conceptId\":\"$AUTO_BUILT_ID\",\"content\":\"should fail on non-active\"}")
ERR=$(is_error "$RAW")
# Can't update a built concept? Actually update doesn't check status, so let's check via list
RAW=$(call_tool "list_concepts" "{\"ideaId\":\"$IDEA2_ID\",\"status\":\"built\",\"limit\":100}")
TEXT=$(get_text "$RAW")
BUILT_LIST=$(echo "$TEXT" | python3 -c "import json,sys; d=json.load(sys.stdin); ids=[i['id'] for i in d['items']]; print('true' if '$AUTO_BUILT_ID' in ids else 'false')")
assert "list_concepts(status=built) includes auto-built concept" "true" "$BUILT_LIST"

# -- Job start increments idea.jobCount --
# We can't directly read the idea jobCount via lean list, but we can verify via get_active
# (jobCount is a new field, not in lean response — this verifies the server didn't crash)

echo ""

# ═══════════════════════════════════════════════════════════════
echo "── Phase 18: Idea Ranking — list_ranked 5-tier model ─────"
# ═══════════════════════════════════════════════════════════════
echo ""

# IDEA1 is archived (graduated + archived earlier), IDEA2 is active with concepts
# The lifecycle phase created concepts and jobs against IDEA2

# -- list_ranked: basic call returns structure --
RAW=$(call_tool "idea" "{\"action\":\"list_ranked\"}")
TEXT=$(get_text "$RAW")
HAS_RANKED=$(echo "$TEXT" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if 'rankedIdeas' in d and 'tierSummary' in d else 'false')")
assert "idea(list_ranked) returns rankedIdeas+tierSummary" "true" "$HAS_RANKED"

# -- list_ranked: archived ideas excluded --
RANKED_IDS=$(echo "$TEXT" | python3 -c "import json,sys; d=json.load(sys.stdin); ids=[i['id'] for i in d['rankedIdeas']]; print(json.dumps(ids))")
ARCHIVED_EXCLUDED=$(echo "$RANKED_IDS" | python3 -c "import json,sys; ids=json.load(sys.stdin); print('true' if '$IDEA1_ID' not in ids else 'false')")
assert "idea(list_ranked) excludes archived ideas" "true" "$ARCHIVED_EXCLUDED"

# -- list_ranked: active idea included --
ACTIVE_INCLUDED=$(echo "$RANKED_IDS" | python3 -c "import json,sys; ids=json.load(sys.stdin); print('true' if '$IDEA2_ID' in ids else 'false')")
assert "idea(list_ranked) includes active ideas" "true" "$ACTIVE_INCLUDED"

# -- list_ranked: each idea has tier fields --
IDEA2_RANKED=$(echo "$TEXT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for i in d['rankedIdeas']:
    if i['id']=='$IDEA2_ID':
        print(json.dumps(i))
        break
else:
    print('null')
")
HAS_TIER_FIELDS=$(echo "$IDEA2_RANKED" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if d is None: print('false')
else:
    keys=['tier','tierLabel','neglected','openCount','decisionCount','unbuiltDecisionCount','completedJobCount','lastActivity','daysSinceActivity']
    print('true' if all(k in d for k in keys) else 'false')
")
assert "idea(list_ranked) idea has all tier fields" "true" "$HAS_TIER_FIELDS"

# -- list_ranked: tier is a valid number 0-5 --
TIER_VAL=$(echo "$IDEA2_RANKED" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tier','X') if d else 'X')")
TIER_VALID=$(python3 -c "print('true' if '$TIER_VAL' in ['0','1','2','3','4','5'] else 'false')")
assert "idea(list_ranked) tier is 0-5" "true" "$TIER_VALID"

# -- list_ranked: tierLabel matches tier --
TIER_LABEL=$(echo "$IDEA2_RANKED" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tierLabel','') if d else '')")
LABEL_MAP='{"0":"Delivered","1":"Build-Ready","2":"Nearly-Ready","3":"Progressing","4":"Early","5":"Exploratory"}'
EXPECTED_LABEL=$(python3 -c "import json; m=json.loads('$LABEL_MAP'); print(m.get('$TIER_VAL',''))")
assert "idea(list_ranked) tierLabel matches tier" "$EXPECTED_LABEL" "$TIER_LABEL"

# -- list_ranked: completedJobCount > 0 (lifecycle job completed in Phase 17) --
COMPLETED_JOBS=$(echo "$IDEA2_RANKED" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('completedJobCount',0) if d else 0)")
HAS_COMPLETED=$(python3 -c "print('true' if int('$COMPLETED_JOBS') > 0 else 'false')")
assert "idea(list_ranked) completedJobCount > 0" "true" "$HAS_COMPLETED"

# -- list_ranked: tierSummary has all keys --
SUMMARY_OK=$(echo "$TEXT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
s=d.get('tierSummary',{})
keys=['buildReady','nearlyReady','progressing','early','exploratory','delivered']
print('true' if all(k in s for k in keys) else 'false')
")
assert "idea(list_ranked) tierSummary has all tier counts" "true" "$SUMMARY_OK"

# -- list_ranked: appId filter --
RAW=$(call_tool "idea" "{\"action\":\"list_ranked\",\"appId\":\"command-center\"}")
TEXT=$(get_text "$RAW")
ALL_HAVE_APPID=$(echo "$TEXT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ideas=d.get('rankedIdeas',[])
if not ideas: print('true')
else: print('true' if all(i.get('appId')=='command-center' for i in ideas) else 'false')
")
assert "idea(list_ranked, appId filter) all ideas have matching appId" "true" "$ALL_HAVE_APPID"

# -- list_ranked: appId filter with nonexistent app returns empty --
RAW=$(call_tool "idea" "{\"action\":\"list_ranked\",\"appId\":\"e2e-nonexistent-app\"}")
TEXT=$(get_text "$RAW")
EMPTY_COUNT=$(echo "$TEXT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('rankedIdeas',[])))")
assert "idea(list_ranked, nonexistent appId) returns 0 ideas" "0" "$EMPTY_COUNT"

# -- list_ranked: neglected is boolean --
NEGLECT_TYPE=$(echo "$IDEA2_RANKED" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if d is None: print('unknown')
else: print('bool' if isinstance(d.get('neglected'), bool) else type(d.get('neglected')).__name__)
")
assert "idea(list_ranked) neglected is boolean" "bool" "$NEGLECT_TYPE"

# -- list_ranked: sort order — tier ascending --
RAW=$(call_tool "idea" "{\"action\":\"list_ranked\"}")
TEXT=$(get_text "$RAW")
SORT_VALID=$(echo "$TEXT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ideas=d.get('rankedIdeas',[])
if len(ideas) <= 1: print('true')
else: print('true' if all(ideas[i]['tier'] <= ideas[i+1]['tier'] for i in range(len(ideas)-1)) else 'false')
")
assert "idea(list_ranked) sorted by tier ascending" "true" "$SORT_VALID"

echo ""

# ═══════════════════════════════════════════════════════════════
echo "── Phase 19: Teardown — Delete All Test Data ─────────────"
# ═══════════════════════════════════════════════════════════════
echo ""

# Collect all IDs created during the test run
TEARDOWN_PASS=0
TEARDOWN_FAIL=0

delete_entity() {
  local tool="$1"
  local id_param="$2"
  local id_val="$3"
  local label="$4"
  if [ -z "$id_val" ] || [ "$id_val" = "None" ] || [ "$id_val" = "null" ]; then
    echo "  ⏭️  $label — skipped (no ID)"
    return
  fi
  local raw=$(call_tool "$tool" "{\"action\":\"delete\",\"${id_param}\":\"${id_val}\"}")
  local err=$(is_error "$raw")
  if [ "$err" = "false" ]; then
    echo "  🗑️  $label ($id_val)"
    TEARDOWN_PASS=$((TEARDOWN_PASS + 1))
  else
    local txt=$(get_text "$raw")
    # "not found" is OK — means it was already cleaned up
    if echo "$txt" | grep -q "not found"; then
      echo "  ⏭️  $label — already gone"
      TEARDOWN_PASS=$((TEARDOWN_PASS + 1))
    else
      echo "  ❌ $label — $txt"
      TEARDOWN_FAIL=$((TEARDOWN_FAIL + 1))
    fi
  fi
}

echo "  Deleting concepts..."
delete_entity "concept" "conceptId" "$CONCEPT1_ID" "concept CONCEPT1"
delete_entity "concept" "conceptId" "$CONCEPT2_ID" "concept CONCEPT2"
delete_entity "concept" "conceptId" "$CONCEPT3_ID" "concept CONCEPT3"
delete_entity "concept" "conceptId" "$CONCEPT4_ID" "concept CONCEPT4"
delete_entity "concept" "conceptId" "$SUPERSEDED_NEW_ID" "concept SUPERSEDED_NEW"
delete_entity "concept" "conceptId" "$FLAG_CONSTRAINT_ID" "concept FLAG_CONSTRAINT"
delete_entity "concept" "conceptId" "$FLAG_DECISION_ID" "concept FLAG_DECISION"
delete_entity "concept" "conceptId" "$JOB_CONCEPT_ID" "concept JOB_CONCEPT"
delete_entity "concept" "conceptId" "$DUAL_CONCEPT_ID" "concept DUAL_CONCEPT"
delete_entity "concept" "conceptId" "$BUILT_CONCEPT_ID" "concept BUILT_CONCEPT"
delete_entity "concept" "conceptId" "$RULE_CONCEPT_ID" "concept RULE_CONCEPT"
delete_entity "concept" "conceptId" "$MIGRATE_CONCEPT_ID" "concept MIGRATE_CONCEPT"
delete_entity "concept" "conceptId" "$AUTO_BUILT_ID" "concept AUTO_BUILT"

echo ""
echo "  Deleting sessions..."
delete_entity "session" "sessionId" "$SESSION_ID" "session SESSION"
delete_entity "session" "sessionId" "$DUAL_SESSION_ID" "session DUAL_SESSION"
delete_entity "session" "sessionId" "$SM_SESSION_ID" "session SM_SESSION"
delete_entity "session" "sessionId" "$DEFAULT_SESSION_ID" "session DEFAULT_SESSION"
delete_entity "session" "sessionId" "$CTX_SESSION_ID" "session CTX_SESSION"

echo ""
echo "  Deleting jobs..."
delete_entity "job" "jobId" "$JOB_ID" "job JOB"
delete_entity "job" "jobId" "$DUAL_JOB_ID" "job DUAL_JOB"
delete_entity "job" "jobId" "$REVIEW_JOB_ID" "job REVIEW_JOB"
delete_entity "job" "jobId" "$STRAIGHT_JOB_ID" "job STRAIGHT_JOB"
delete_entity "job" "jobId" "$DRAFT_JOB_ID" "job DRAFT_JOB"
delete_entity "job" "jobId" "$DRAFT2_JOB_ID" "job DRAFT2_JOB"
delete_entity "job" "jobId" "$MAINT_JOB_ID" "job MAINT_JOB"
delete_entity "job" "jobId" "$BC_JOB_ID" "job BC_JOB"
delete_entity "job" "jobId" "$LIFECYCLE_JOB_ID" "job LIFECYCLE_JOB"

echo ""
echo "  Deleting ideas..."
delete_entity "idea" "ideaId" "$IDEA1_ID" "idea IDEA1"
delete_entity "idea" "ideaId" "$IDEA2_ID" "idea IDEA2"

echo ""
echo "  Deleting remaining documents..."
delete_entity "document" "docId" "$DOC1_ID" "doc DOC1"
delete_entity "document" "docId" "$DOC2_ID" "doc DOC2"
delete_entity "document" "docId" "$DOC3_ID" "doc DOC3"
delete_entity "document" "docId" "$DOC_PERM_ID" "doc DOC_PERM"

echo ""
echo "  Teardown: $TEARDOWN_PASS deleted / $TEARDOWN_FAIL failed"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  Results: $PASS passed / $FAIL failed / $TOTAL total"
echo "  Teardown: $TEARDOWN_PASS deleted / $TEARDOWN_FAIL failed"
echo ""
if [ $FAIL -eq 0 ]; then
  echo "  🎉 ALL TESTS PASSED"
else
  echo "  ⚠️  $FAIL TESTS FAILED"
fi
echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""
