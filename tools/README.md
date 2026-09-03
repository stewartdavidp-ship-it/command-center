# tools/

Server-side operations. No browser, no logged-in tab, no UI.

## Why these exist

Domain work used to be possible only from Command Center's Domains page, because the
registrar API credentials lived in that page's `localStorage` and nowhere else. That made
every domain task depend on a browser profile and a reachable site — and when
`aicommandcenter.dev` stopped resolving, the capability went with it. Worse, the *process*
itself was never written down as a runnable thing: only fragments existed, so every new
domain got reconstructed by hand and felt new.

Credentials belong in Secret Manager. Processes belong in scripts.

---

## domain.mjs — stand up a domain, end to end

    node tools/domain.mjs status  <domain>
    node tools/domain.mjs standup <domain> --worker=<name>       # Cloudflare Worker
    node tools/domain.mjs standup <domain> --pages=<owner/repo>  # GitHub Pages
    # --dry-run on any standup prints the plan and changes nothing

**Re-running is the intended workflow, not a retry.** Every step reads current state before
it writes and no-ops when already correct. DNS propagation means the first run almost always
stops at "zone pending"; run it again once Cloudflare activates and it continues from there.

`status` puts the whole picture on one screen: registrar nameservers, parking records,
Cloudflare zone + account + activation state, worker bindings, and a live HTTP check. It
degrades gracefully — Cloudflare and liveness still report when registrar credentials are
absent.

### The one fork that matters

Conflating these two is what made domain work feel endlessly repetitive:

| Target | What it needs | Delegation? |
|---|---|---|
| **GitHub Pages** | four A records to `185.199.108–111.153` + a `www` CNAME, at the **current registrar** | **No.** The registrar keeps DNS. |
| **Cloudflare Worker** | zone in the **same Cloudflare account as the worker**, then a Workers custom domain | **Yes.** Nameservers move to Cloudflare. |

Most of the estate is the first shape, which is why the delegation gap stayed invisible for
years and only surfaced when a Worker custom domain needed it.

### Steps, worker target

1. **Cloudflare zone** — must already exist (see below).
2. **Clear registrar parking** — a new Porkbun domain arrives with URL forwarding and records pointing at `207.207.210.x` / `*.porkbun.com`. Left in place they land on the apex and fight the Worker custom domain.
3. **Delegate** — set the registrar's nameservers to exactly the ones the zone reports.
4. **Activation** — stops and tells you to re-run if the zone is still `pending`.
5. **Bind** — Workers custom domains for apex and `www`, skipping any already bound.
6. **Verify** — a real HTTPS request, reported as a status code.

### The one manual step

**Creating the Cloudflare zone.** Neither stored credential can do it: the Secret Manager
`CLOUDFLARE_API_TOKEN` is scoped to a *different account* and returns `Unauthorized`, and the
wrangler OAuth login fails with `Requires permission com.cloudflare.api.account.zone.create`.

Dashboard → **Add a site** → the domain → **Free** → **manual DNS entry** (not auto-import —
auto-import pulls the parking records onto the apex). Then re-run `standup`.

**Pick the account deliberately.** There are two and their names are crossed over; the one
holding a given worker is often not the one a stored token belongs to.

To automate this step someday: mint a token with `Zone:Create` scoped to the worker's account
and store it under a **new** Secret Manager name — never overwrite `CLOUDFLARE_API_TOKEN`.

---

## porkbun.mjs — registrar primitives

    node tools/porkbun.mjs ping                                  # cheapest credential check
    node tools/porkbun.mjs domains
    node tools/porkbun.mjs ns:get   <domain>
    node tools/porkbun.mjs ns:set   <domain> <ns1> <ns2> [...]
    node tools/porkbun.mjs ns:reset <domain>                     # back to Porkbun's own
    node tools/porkbun.mjs dns:list <domain>
    node tools/porkbun.mjs dns:add  <domain> <type> <name|@> <content> [ttl]
    node tools/porkbun.mjs dns:delete <domain> <recordId>
    node tools/porkbun.mjs delegate <domain>                     # NS only, no parking/binding

Also importable — `domain.mjs` uses its `pb`, `cfZone`, `setNs`, `readCredentials` helpers.
The CLI only runs when the file is invoked directly.

---

## Credentials

GCP Secret Manager, project `mast-platform-prod`: **`PORKBUN_API_KEY`** and
**`PORKBUN_SECRET_KEY`** (same-named env vars override). Never printed, never logged, never
passed as argv. Cloudflare reads use the local `wrangler` OAuth login, falling back to
`CLOUDFLARE_API_TOKEN`.

### Porkbun facts worth not rediscovering

- Auth is a JSON **body** on every endpoint (`{"apikey":…,"secretapikey":…}`), never a header.
- Nameservers: `POST /domain/getNs/{d}`, `POST /domain/updateNs/{d}` with `{ns:[...]}`.
- **A secret key is shown only at creation.** It cannot be read back later. If the secret is
  lost, the key is dead — mint a new one; do not go looking for the old value.
- **API key titles are limited to 1–15 characters.** A longer one fails validation rather
  than truncating.
- Account setting **"Opt In All Domains"** (on the API page) grants API access to all
  domains including future registrations. With it on, no per-domain toggle is needed.

### Rotating the key without leaking it

Do **not** read the values out of the page with an accessibility-tree query — that returns
them as plaintext into whatever is driving the browser. Instead click the page's own
**copy api key** / **copy secret key** buttons and pipe the clipboard straight through:

    pbpaste | tr -d '\n' | gcloud secrets create PORKBUN_API_KEY    --project=mast-platform-prod --data-file=-
    pbpaste | tr -d '\n' | gcloud secrets create PORKBUN_SECRET_KEY --project=mast-platform-prod --data-file=-

(Use `versions add` instead of `create` when the secret already exists.) Then confirm with
`node tools/porkbun.mjs ping`, which round-trips the stored value and prints your IP.
