#!/usr/bin/env node
/**
 * porkbun.mjs — server-side Porkbun control. No browser, no UI, no logged-in tab.
 *
 * WHY THIS EXISTS (2026-09-03). Domain work was only doable from Command Center's
 * Domains page, because the API credentials lived in that page's localStorage and
 * nowhere else. That makes every domain task depend on a browser, a profile, and a
 * reachable site — and when aicommandcenter.dev stopped resolving, the whole
 * capability went with it. Credentials belong in Secret Manager and the process
 * belongs in a script.
 *
 * CREDENTIALS, in order of preference:
 *   1. GCP Secret Manager: PORKBUN_API_KEY + PORKBUN_SECRET_KEY (project below)
 *   2. env: PORKBUN_API_KEY + PORKBUN_SECRET_KEY
 * The key is never printed, never logged, and never passed as an argv.
 *
 * USAGE
 *   node tools/porkbun.mjs ping
 *   node tools/porkbun.mjs domains
 *   node tools/porkbun.mjs ns:get      <domain>
 *   node tools/porkbun.mjs ns:set      <domain> <ns1> <ns2> [ns3...]
 *   node tools/porkbun.mjs ns:reset    <domain>                  # back to Porkbun's own
 *   node tools/porkbun.mjs dns:list    <domain>
 *   node tools/porkbun.mjs dns:add     <domain> <type> <name|@> <content> [ttl]
 *   node tools/porkbun.mjs dns:delete  <domain> <recordId>
 *   node tools/porkbun.mjs delegate    <domain>                  # the whole job, one command
 *
 * `delegate` is the process this file was written for: read the zone's assigned
 * nameservers from Cloudflare, then set exactly those at Porkbun. It refuses if the
 * zone does not exist, so it cannot delegate a domain into a black hole.
 *
 * Add --dry-run to any mutating command to print what would be sent and exit.
 */

import { execFileSync } from 'node:child_process';

const API = 'https://api.porkbun.com/api/json/v3';
const CF_API = 'https://api.cloudflare.com/client/v4';
const SECRET_PROJECT = 'mast-platform-prod';
const PORKBUN_NS = [
  'curitiba.ns.porkbun.com', 'fortaleza.ns.porkbun.com',
  'maceio.ns.porkbun.com', 'salvador.ns.porkbun.com',
];

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const args = argv.filter((a) => a !== '--dry-run');
const [cmd, ...rest] = args;

function die(msg, code = 1) { console.error(`✗ ${msg}`); process.exit(code); }

function fromSecretManager(name) {
  try {
    return execFileSync('gcloud', [
      'secrets', 'versions', 'access', 'latest',
      `--secret=${name}`, `--project=${SECRET_PROJECT}`,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
}

let _credCache;
/** Returns the pair, or null. Never exits — callers that can degrade use this. */
function readCredentials() {
  if (_credCache !== undefined) return _credCache;
  const apikey = process.env.PORKBUN_API_KEY || fromSecretManager('PORKBUN_API_KEY');
  const secretapikey = process.env.PORKBUN_SECRET_KEY || fromSecretManager('PORKBUN_SECRET_KEY');
  _credCache = apikey && secretapikey ? { apikey, secretapikey } : null;
  return _credCache;
}

function credentials() {
  const c = readCredentials();
  if (!c) {
    die(
      'No Porkbun credentials.\n' +
      `  Store them once and every future run finds them:\n` +
      `    printf '%s' '<apiKey>'       | gcloud secrets create PORKBUN_API_KEY    --project=${SECRET_PROJECT} --data-file=-\n` +
      `    printf '%s' '<secretApiKey>' | gcloud secrets create PORKBUN_SECRET_KEY --project=${SECRET_PROJECT} --data-file=-\n` +
      `  Generate a pair at https://porkbun.com/account/api if you do not have them.\n` +
      `  (Historically these lived only in localStorage["cc_domain_config"] on aicommandcenter.dev.)`
    );
  }
  return c;
}

/** Porkbun authenticates by JSON BODY on every endpoint — never a header. */
async function pb(endpoint, body = {}) {
  const res = await fetch(`${API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...credentials(), ...body }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { die(`Porkbun returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`); }
  if (data.status !== 'SUCCESS') die(`Porkbun: ${data.message || `HTTP ${res.status}`}`);
  return data;
}

/** Cloudflare, read-only here, via the local wrangler OAuth login. */
function cloudflareToken() {
  const path = `${process.env.HOME}/Library/Preferences/.wrangler/config/default.toml`;
  try {
    const toml = execFileSync('cat', [path], { encoding: 'utf8' });
    const m = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  } catch { /* fall through */ }
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  die('No Cloudflare credential. Run `npx wrangler login`, or set CLOUDFLARE_API_TOKEN.');
}

async function cfZone(domain) {
  const res = await fetch(`${CF_API}/zones?name=${encodeURIComponent(domain)}`, {
    headers: { Authorization: `Bearer ${cloudflareToken()}` },
  });
  const data = await res.json();
  if (!data.success) die(`Cloudflare: ${(data.errors || []).map((e) => e.message).join('; ')}`);
  return (data.result || [])[0] || null;
}

const need = (n, usage) => { if (rest.length < n) die(`usage: ${usage}`); };

const COMMANDS = {
  async ping() {
    const d = await pb('/ping');
    console.log(`✓ credentials valid — your IP ${d.yourIp}`);
  },

  async domains() {
    const d = await pb('/domain/listAll');
    for (const x of d.domains || []) {
      console.log(`${x.domain.padEnd(28)} expires ${x.expireDate}  autorenew ${x.autoRenew}`);
    }
  },

  async 'ns:get'() {
    need(1, 'ns:get <domain>');
    const d = await pb(`/domain/getNs/${rest[0]}`);
    (d.ns || []).forEach((n) => console.log(n));
  },

  async 'ns:set'() {
    need(3, 'ns:set <domain> <ns1> <ns2> [ns3...]');
    const [domain, ...ns] = rest;
    await setNs(domain, ns);
  },

  async 'ns:reset'() {
    need(1, 'ns:reset <domain>');
    await setNs(rest[0], PORKBUN_NS);
  },

  async 'dns:list'() {
    need(1, 'dns:list <domain>');
    const d = await pb(`/dns/retrieve/${rest[0]}`);
    for (const r of d.records || []) {
      console.log(`${String(r.id).padEnd(12)} ${r.type.padEnd(6)} ${(r.name || '@').padEnd(34)} ${r.content}`);
    }
  },

  async 'dns:add'() {
    need(4, 'dns:add <domain> <type> <name|@> <content> [ttl]');
    const [domain, type, name, content, ttl = '600'] = rest;
    const body = { type, name: name === '@' ? '' : name, content, ttl };
    if (DRY) return console.log(`dry-run: POST /dns/create/${domain}`, body);
    const d = await pb(`/dns/create/${domain}`, body);
    console.log(`✓ created record ${d.id}`);
  },

  async 'dns:delete'() {
    need(2, 'dns:delete <domain> <recordId>');
    const [domain, id] = rest;
    if (DRY) return console.log(`dry-run: POST /dns/delete/${domain}/${id}`);
    await pb(`/dns/delete/${domain}/${id}`);
    console.log(`✓ deleted record ${id}`);
  },

  /**
   * THE PROCESS. Cloudflare is the source of truth for which nameservers a zone
   * wants; this reads them and writes exactly those. Refuses if no zone exists,
   * because delegating to a zone that is not there takes the domain offline with
   * no way for DNS to answer.
   */
  async delegate() {
    need(1, 'delegate <domain>');
    const domain = rest[0];
    const zone = await cfZone(domain);
    if (!zone) {
      die(`No Cloudflare zone for ${domain}. Create it in the account that holds the worker\n` +
          `  (see the KT node on the two Cloudflare accounts), then run this again.`);
    }
    const ns = zone.name_servers || [];
    if (ns.length < 2) die(`Cloudflare reported ${ns.length} nameservers for ${domain}; refusing.`);
    console.log(`Cloudflare zone ${zone.id} (${zone.status}) wants:`);
    ns.forEach((n) => console.log(`  ${n}`));
    await setNs(domain, ns);
    if (zone.status !== 'active') {
      console.log(`\nZone is "${zone.status}". Cloudflare activates once it sees the delegation;`);
      console.log(`propagation can take up to 48h, usually minutes. Re-check with:`);
      console.log(`  node tools/porkbun.mjs ns:get ${domain}`);
    }
  },
};

async function setNs(domain, ns) {
  const list = ns.map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (list.length < 2) die('At least two nameservers are required.');
  const current = (await pb(`/domain/getNs/${domain}`)).ns || [];
  console.log(`current: ${current.join(', ') || '(none)'}`);
  console.log(`new:     ${list.join(', ')}`);
  // Compare as SETS, not sequences. Porkbun returns nameservers in arbitrary order,
  // so an order-sensitive check reports "changed" on every run and issues a pointless
  // write. Measured 2026-09-03: a second standup re-sent an identical pair.
  const norm = (a) => [...a].map((n) => n.trim().toLowerCase()).sort().join(',');
  if (norm(current) === norm(list)) {
    return console.log('✓ already set — nothing to do');
  }
  if (DRY) return console.log(`dry-run: POST /domain/updateNs/${domain}`);
  await pb(`/domain/updateNs/${domain}`, { ns: list });
  console.log(`✓ nameservers updated for ${domain}`);
}

export { pb, cfZone, cloudflareToken, setNs, credentials, readCredentials, PORKBUN_NS, die };

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('porkbun.mjs');
if (!invokedDirectly) { /* imported as a library — do not run the CLI */ }
else await main();

async function main() {
const run = COMMANDS[cmd];
if (!run) {
  console.error(`usage: node tools/porkbun.mjs <command> [args] [--dry-run]\n`);
  console.error(`commands: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(cmd ? 1 : 0);
}
await run().catch((e) => die(e.message));
}
