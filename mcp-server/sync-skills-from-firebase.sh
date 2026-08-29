#!/bin/bash
# Regenerate src/skills.ts from the live Firebase-stored skills.
#
# Firebase is the source of truth for skill CONTENT. The compiled constants in
# src/skills.ts exist only as a cold-cache fallback (see skill-cache.ts →
# loadFromCompiled) for when the Firebase read fails at startup. They are a
# generated snapshot, never hand-authored.
#
# Usage:
#   bash sync-skills-from-firebase.sh          # regenerate from TEST (default)
#   bash sync-skills-from-firebase.sh --prod   # regenerate from PRODUCTION
#   bash sync-skills-from-firebase.sh --check  # drift check: exit 1 if stale, write nothing
#
# --check is the CI-friendly form: it reports whether the committed snapshot
# still matches Firebase without touching the working tree.

set -e

ENV="test"
CHECK_ONLY=false
for arg in "$@"; do
  case $arg in
    --prod) ENV="prod" ;;
    --check) CHECK_ONLY=true ;;
  esac
done

if [ "$ENV" = "prod" ]; then
  URL="https://cc-mcp-server-300155036194.us-central1.run.app/mcp"
else
  URL="https://cc-mcp-server-test-300155036194.us-central1.run.app/mcp"
fi
AUTH="Authorization: Bearer cc_oUt4ba0dYVRBfPREqoJ1yIsJKjr1_wxityxnkh8pqw1vu7ztmp"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/src/skills.ts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "═══════════════════════════════════════════════════════════"
echo "  CC Skill Snapshot — Firebase → src/skills.ts"
echo "  Environment: $ENV"
echo "  Mode: $([ "$CHECK_ONLY" = true ] && echo 'check (read-only)' || echo 'write')"
echo "═══════════════════════════════════════════════════════════"
echo ""

call_tool() {
  curl -s -X POST "$URL" \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"skill\",\"arguments\":$1}}" \
    2>/dev/null | grep "^data:" | sed 's/^data: //' || true
}

get_text() {
  python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    print(json.dumps(d.get('result',{}).get('content',[{}])[0].get('text','')))
except Exception:
    print('\"\"')
"
}

echo "── Reading skill list ──"
call_tool '{"action":"list"}' > "$WORK/list.raw"
python3 - "$WORK" <<'PY'
import json,sys
work=sys.argv[1]
d=json.load(open(work+'/list.raw'))
t=json.loads(d['result']['content'][0]['text'])
src=t.get('source')
if src != 'firebase':
    print(f"  ABORT: server cache source is '{src}', not 'firebase'.")
    print("  Regenerating from a compiled-fallback cache would just echo the")
    print("  existing snapshot back and mask the real Firebase content.")
    sys.exit(3)
json.dump(t, open(work+'/list.json','w'))
print(f"  {t['count']} skills (source: {src})")
PY

python3 -c "
import json;t=json.load(open('$WORK/list.json'))
open('$WORK/names.txt','w').write('\n'.join(s['name'] for s in t['skills'])+'\n')"

echo ""
echo "── Fetching skill content ──"
COUNT=0
while IFS= read -r n; do
  [ -z "$n" ] && continue
  call_tool "{\"action\":\"get\",\"skillName\":\"$n\"}" > "$WORK/raw.json"
  if [ ! -s "$WORK/raw.json" ]; then
    echo "  ❌ $n — empty response, aborting (refusing to write a partial snapshot)"
    exit 1
  fi
  get_text < "$WORK/raw.json" > "$WORK/content_$COUNT.json"
  echo "$n" >> "$WORK/fetched.txt"
  COUNT=$((COUNT + 1))
done < "$WORK/names.txt"
echo "  fetched $COUNT skills"

echo ""
echo "── Generating src/skills.ts ──"
python3 - "$WORK" "$TARGET" "$CHECK_ONLY" "$ENV" <<'PY'
import json, sys, os

work, target, check_only, env = sys.argv[1], sys.argv[2], sys.argv[3] == 'true', sys.argv[4]

meta = {s['name']: s for s in json.load(open(work + '/list.json'))['skills']}
names = [l.strip() for l in open(work + '/fetched.txt') if l.strip()]

skills = []
for i, n in enumerate(names):
    content = json.load(open(f'{work}/content_{i}.json'))
    if not content.strip():
        print(f"  ABORT: {n} returned empty content"); sys.exit(1)
    m = meta[n]
    skills.append({
        'name': n,
        'description': m.get('description', ''),
        'category': m.get('category', 'custom'),
        'content': content,
    })

skills.sort(key=lambda s: s['name'])

def lit(s):
    # JSON string literals are valid TS string literals and need no
    # template-literal escaping. This is deliberate: the previous hand-authored
    # file used backtick templates, and over-escaped backticks (\` written as
    # \\\`) leaked literal backslashes into 620 places in the served content.
    return json.dumps(s, ensure_ascii=False)

out = []
out.append('// ─────────────────────────────────────────────────────────────────────────')
out.append('// GENERATED FILE — DO NOT EDIT BY HAND.')
out.append('//')
out.append('// Regenerate with:  bash sync-skills-from-firebase.sh --prod')
out.append('// Drift check with: bash sync-skills-from-firebase.sh --prod --check')
out.append('//')
out.append('// Firebase RTDB is the source of truth for skill content. Skills are authored')
out.append('// and edited through the `skill` MCP tool (action="create"/"update"), which')
out.append('// write-throughs to Firebase and the in-memory cache. This file is a snapshot')
out.append('// of that content, compiled in solely as a cold-cache fallback for when the')
out.append('// Firebase read fails at startup (see skill-cache.ts → loadFromCompiled).')
out.append('//')
out.append('// Editing a skill here does NOT change what agents receive — the cache is')
out.append('// served from Firebase. Use the `skill` tool, then re-run the sync script.')
out.append(f'//')
out.append(f'// Snapshot source: {env}')
out.append(f'// Skills: {len(skills)}')
out.append('// ─────────────────────────────────────────────────────────────────────────')
out.append('')
out.append('import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";')
out.append('import { getAllCachedSkills } from "./skill-cache.js";')
out.append('')
out.append('interface SkillEntry {')
out.append('  name: string;')
out.append('  description: string;')
out.append('  category: string;')
out.append('  content: string;')
out.append('}')
out.append('')
out.append('const SKILL_REGISTRY: SkillEntry[] = [')
for s in skills:
    out.append('  {')
    out.append(f'    name: {lit(s["name"])},')
    out.append(f'    description: {lit(s["description"])},')
    out.append(f'    category: {lit(s["category"])},')
    out.append(f'    content: {lit(s["content"])},')
    out.append('  },')
out.append('];')
out.append('')
out.append('/**')
out.append(' * Register every skill as an MCP prompt.')
out.append(' *')
out.append(' * Prefers the Firebase-backed cache. Falls back to the compiled snapshot only')
out.append(' * when the cache is empty, which means the startup Firebase read failed.')
out.append(' */')
out.append('export function registerSkillPrompts(server: McpServer): void {')
out.append('  const cached = getAllCachedSkills();')
out.append('  const entries: { name: string; description: string; content: string }[] =')
out.append('    cached.length > 0 ? cached : SKILL_REGISTRY;')
out.append('')
out.append('  if (cached.length === 0) {')
out.append('    console.warn(')
out.append('      `[skills] Cache empty — registering ${SKILL_REGISTRY.length} prompts from the compiled snapshot`,')
out.append('    );')
out.append('  }')
out.append('')
out.append('  for (const skill of entries) {')
out.append('    server.prompt(')
out.append('      skill.name,')
out.append('      skill.description,')
out.append('      {},')
out.append('      async () => ({')
out.append('        messages: [{')
out.append('          role: "user" as const,')
out.append('          content: { type: "text" as const, text: skill.content },')
out.append('        }],')
out.append('      }),')
out.append('    );')
out.append('  }')
out.append('}')
out.append('')
out.append('/** Compiled snapshot, used by skill-cache.ts when Firebase is unreachable. */')
out.append('export function getCompiledSkillRegistry(): SkillEntry[] {')
out.append('  return SKILL_REGISTRY;')
out.append('}')
out.append('')

new = '\n'.join(out)
old = open(target).read() if os.path.exists(target) else ''

if new == old:
    print(f"  ✅ src/skills.ts already matches Firebase ({len(skills)} skills) — no change")
    sys.exit(0)

if check_only:
    print(f"  ⚠️  DRIFT: src/skills.ts does not match Firebase ({len(skills)} skills)")
    print("  Run without --check to regenerate.")
    sys.exit(1)

open(target, 'w').write(new)
print(f"  ✅ wrote src/skills.ts — {len(skills)} skills, {len(new)} chars")
PY
