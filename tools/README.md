# tools/

Server-side operations. No browser, no logged-in tab, no UI.

## Why these exist

Domain work used to be possible only from Command Center's Domains page, because the
registrar API credentials lived in that page's `localStorage` and nowhere else. That made
every domain task depend on a browser profile and a reachable site — and when
`aicommandcenter.dev` stopped resolving, the capability went with it. Credentials belong in
Secret Manager; processes belong in scripts.

## porkbun.mjs

    node tools/porkbun.mjs delegate <domain>

The one command for the recurring job: read the nameservers Cloudflare assigned to the
zone, then set exactly those at Porkbun. Refuses if no Cloudflare zone exists, so a domain
cannot be delegated into a black hole. Add `--dry-run` to any mutating command.

Also: `ping`, `domains`, `ns:get`, `ns:set`, `ns:reset`, `dns:list`, `dns:add`, `dns:delete`.

**Credentials** come from GCP Secret Manager (`PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY` in
`mast-platform-prod`), falling back to the same env vars. They are never printed, never
logged, and never passed as argv. Store them once:

    printf '%s' '<apiKey>'       | gcloud secrets create PORKBUN_API_KEY    --project=mast-platform-prod --data-file=-
    printf '%s' '<secretApiKey>' | gcloud secrets create PORKBUN_SECRET_KEY --project=mast-platform-prod --data-file=-

Generate a pair at https://porkbun.com/account/api. Porkbun authenticates by JSON **body**
on every endpoint, never a header.

Cloudflare reads use the local `wrangler` OAuth login, falling back to
`CLOUDFLARE_API_TOKEN`. Note that the account holding a given worker may not be the account
a stored token belongs to — check before assuming.
