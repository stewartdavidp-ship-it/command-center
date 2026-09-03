#!/usr/bin/env node
/**
 * domain.mjs — stand up a domain, end to end, idempotently.
 *
 * WHY THIS EXISTS (2026-09-03). Every new Porkbun domain went through the same
 * hand-run sequence — create the Cloudflare zone, remember WHICH Cloudflare account,
 * clear the parking records, set the nameservers, wait, bind the worker, check it —
 * and none of it was written down as a runnable thing. Only fragments were: a UI
 * nobody opens, and whatever the session in front of you happened to remember. So it
 * felt new every time, because operationally it was.
 *
 *   node tools/domain.mjs status  <domain>
 *   node tools/domain.mjs standup <domain> --worker=<name>       # Cloudflare Worker
 *   node tools/domain.mjs standup <domain> --pages=<owner/repo>  # GitHub Pages
 *
 * EVERY STEP CHECKS BEFORE IT WRITES. Re-running is safe and is the intended way to
 * resume: DNS propagation means you will run this more than once per domain.
 * `--dry-run` prints the plan and changes nothing.
 *
 * The two targets differ in a way worth knowing, because confusing them is what made
 * this feel repetitive for years:
 *   · GitHub Pages  — A records at the CURRENT registrar. No delegation. Porkbun keeps DNS.
 *   · Worker        — the zone must live in the SAME Cloudflare account as the worker,
 *                     which means delegating the domain to Cloudflare's nameservers.
 */

import { pb, cfZone, cloudflareToken, setNs, readCredentials, die } from './porkbun.mjs';

const CF_API = 'https://api.cloudflare.com/client/v4';
const GITHUB_PAGES_IPS = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];
/** Porkbun parks new domains here; these must not survive a standup. */
const PARKING_PREFIX = '207.207.210.';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const flags = Object.fromEntries(
  argv.filter((a) => a.startsWith('--') && a.includes('='))
      .map((a) => [a.slice(2).split('=')[0], a.slice(2).split('=').slice(1).join('=')])
);
const positional = argv.filter((a) => !a.startsWith('--'));
const [cmd, domain] = positional;

const ok = (m) => console.log(`  ✓ ${m}`);
const skip = (m) => console.log(`  · ${m}`);
const act = (m) => console.log(`  → ${m}`);

async function cf(path, init = {}) {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cloudflareToken()}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) {
    throw new Error(`Cloudflare ${path}: ${(data.errors || []).map((e) => e.message).join('; ') || `HTTP ${res.status}`}`);
  }
  return data.result;
}

async function workerDomains(accountId) {
  return await cf(`/accounts/${accountId}/workers/domains`);
}

async function httpCheck(host) {
  try {
    const res = await fetch(`https://${host}/`, { redirect: 'manual' });
    return `HTTP ${res.status}`;
  } catch (e) {
    return `unreachable (${e.cause?.code || e.message})`;
  }
}

/** Everything known about a domain, from the registrar, Cloudflare and the wire. */
async function status(d) {
  console.log(`\n${d}\n${'─'.repeat(d.length)}`);

  const haveRegistrar = !!readCredentials();
  let ns = [];
  if (!haveRegistrar) {
    console.log(`registrar: no Porkbun credentials — set PORKBUN_API_KEY / PORKBUN_SECRET_KEY`);
    console.log(`           (Cloudflare and liveness below are still accurate)`);
  } else {
    try {
      ns = (await pb(`/domain/getNs/${d}`)).ns || [];
      console.log(`registrar nameservers: ${ns.join(', ')}`);
    } catch (e) {
      console.log(`registrar nameservers: (could not read — ${e.message})`);
    }
  }
  const delegatedToCf = ns.some((n) => n.endsWith('.ns.cloudflare.com'));

  let records = [];
  if (haveRegistrar) try {
    records = (await pb(`/dns/retrieve/${d}`)).records || [];
    const parked = records.filter((r) => r.type === 'A' && r.content.startsWith(PARKING_PREFIX));
    console.log(`registrar DNS: ${records.length} records${parked.length ? ` (${parked.length} still parked)` : ''}`);
    if (!delegatedToCf && records.length) {
      for (const r of records.slice(0, 8)) console.log(`   ${r.type.padEnd(6)} ${(r.name || '@').padEnd(30)} ${r.content}`);
    }
  } catch { /* registrar creds may be absent; status still useful */ }

  const zone = await cfZone(d);
  if (!zone) {
    console.log(`cloudflare: no zone`);
  } else {
    console.log(`cloudflare: zone ${zone.id} — ${zone.status}, account ${zone.account?.name} (${zone.account?.id})`);
    console.log(`   assigned nameservers: ${(zone.name_servers || []).join(', ')}`);
    if (zone.status === 'active') {
      const doms = await workerDomains(zone.account.id);
      const bound = doms.filter((x) => x.zone_id === zone.id);
      console.log(`   worker custom domains: ${bound.length ? bound.map((b) => `${b.hostname} → ${b.service}`).join(', ') : 'none'}`);
    }
  }

  console.log(`live: ${await httpCheck(d)}`);
  if (ns.length && !delegatedToCf && zone) {
    console.log(`\n⚠ zone exists but the domain is NOT delegated to it. Nothing in Cloudflare takes effect yet.`);
  }
}

/** Delete registrar records that only exist because the domain was parked. */
async function clearParking(d) {
  const records = (await pb(`/dns/retrieve/${d}`)).records || [];
  const parked = records.filter(
    (r) => (r.type === 'A' && r.content.startsWith(PARKING_PREFIX)) ||
           (r.type === 'ALIAS' && /porkbun/.test(r.content)) ||
           (r.type === 'CNAME' && /porkbun/.test(r.content))
  );
  if (!parked.length) return skip('no parking records to clear');
  for (const r of parked) {
    if (DRY) { act(`would delete ${r.type} ${r.name || '@'} → ${r.content}`); continue; }
    await pb(`/dns/delete/${d}/${r.id}`);
    ok(`deleted ${r.type} ${r.name || '@'} → ${r.content}`);
  }
}

async function standupWorker(d, worker) {
  console.log(`\nStanding up ${d} → Cloudflare Worker "${worker}"\n`);

  console.log('1. Cloudflare zone');
  const zone = await cfZone(d);
  if (!zone) {
    die(`No Cloudflare zone for ${d}.\n` +
        `  Create it in the account that holds the worker — NOT necessarily the account a stored\n` +
        `  token belongs to. Neither the Secret Manager token nor the wrangler OAuth login can\n` +
        `  create zones (zone.create is missing from both), so this step is the dashboard:\n` +
        `    https://dash.cloudflare.com/  →  Add a site  →  ${d}  →  Free  →  manual DNS entry\n` +
        `  Then re-run this command.`);
  }
  ok(`zone ${zone.id} in ${zone.account?.name} (${zone.status})`);

  console.log('2. Registrar parking records');
  await clearParking(d);

  console.log('3. Nameserver delegation');
  const want = zone.name_servers || [];
  if (want.length < 2) die(`Cloudflare reported ${want.length} nameservers; refusing.`);
  const have = (await pb(`/domain/getNs/${d}`)).ns || [];
  const norm = (a) => [...a].map((n) => n.trim().toLowerCase()).sort().join(',');
  if (norm(have) === norm(want)) {
    skip(`already delegated to ${want.join(', ')}`);
  } else if (DRY) {
    act(`would set nameservers to ${want.join(', ')}`);
  } else {
    await setNs(d, want);
  }

  console.log('4. Zone activation');
  if (zone.status !== 'active') {
    console.log(`  · zone is "${zone.status}". Cloudflare activates once it sees the delegation —`);
    console.log(`    usually minutes, up to 48h. Re-run this command to continue; every step above is idempotent.`);
    console.log(`\nlive: ${await httpCheck(d)}`);
    return;
  }
  ok('zone active');

  console.log('5. Worker custom domain');
  const existing = (await workerDomains(zone.account.id)).filter((x) => x.zone_id === zone.id);
  for (const hostname of [d, `www.${d}`]) {
    if (existing.some((x) => x.hostname === hostname)) { skip(`${hostname} already bound`); continue; }
    if (DRY) { act(`would bind ${hostname} → ${worker}`); continue; }
    await cf(`/accounts/${zone.account.id}/workers/domains`, {
      method: 'PUT',
      body: JSON.stringify({ zone_id: zone.id, hostname, service: worker, environment: 'production' }),
    });
    ok(`bound ${hostname} → ${worker}`);
  }

  console.log('\n6. Verify');
  console.log(`  live: ${await httpCheck(d)}`);
  console.log(`  (a fresh certificate can take a few minutes; re-run \`status\` if it is not up yet)`);
}

async function standupPages(d, repo) {
  const [owner] = repo.split('/');
  console.log(`\nStanding up ${d} → GitHub Pages (${repo})\n`);
  console.log('NOTE: Pages needs A records at the CURRENT registrar. No delegation, no Cloudflare zone.');

  console.log('1. Registrar parking records');
  await clearParking(d);

  console.log('2. A records → GitHub Pages');
  const records = (await pb(`/dns/retrieve/${d}`)).records || [];
  const haveA = records.filter((r) => r.type === 'A' && r.name === d).map((r) => r.content);
  for (const ip of GITHUB_PAGES_IPS) {
    if (haveA.includes(ip)) { skip(`A @ → ${ip} present`); continue; }
    if (DRY) { act(`would add A @ → ${ip}`); continue; }
    await pb(`/dns/create/${d}`, { type: 'A', name: '', content: ip, ttl: '600' });
    ok(`added A @ → ${ip}`);
  }

  console.log('3. www CNAME');
  const wwwHost = `www.${d}`;
  const haveWww = records.find((r) => r.type === 'CNAME' && r.name === wwwHost);
  const target = `${owner}.github.io`;
  if (haveWww && haveWww.content === target) skip(`www → ${target} present`);
  else if (DRY) act(`would add CNAME www → ${target}`);
  else {
    await pb(`/dns/create/${d}`, { type: 'CNAME', name: 'www', content: target, ttl: '600' });
    ok(`added CNAME www → ${target}`);
  }

  console.log('\n4. Verify');
  console.log(`  live: ${await httpCheck(d)}`);
  console.log(`  Also confirm the repo has a CNAME file containing "${d}" and Pages is enabled on main.`);
}

if (!cmd || !domain) {
  console.error('usage:');
  console.error('  node tools/domain.mjs status  <domain>');
  console.error('  node tools/domain.mjs standup <domain> --worker=<name>');
  console.error('  node tools/domain.mjs standup <domain> --pages=<owner/repo>');
  console.error('  (add --dry-run to any standup)');
  process.exit(cmd ? 1 : 0);
}

try {
  if (cmd === 'status') await status(domain);
  else if (cmd === 'standup' && flags.worker) await standupWorker(domain, flags.worker);
  else if (cmd === 'standup' && flags.pages) await standupPages(domain, flags.pages);
  else die('standup needs --worker=<name> or --pages=<owner/repo>');
} catch (e) { die(e.message); }
