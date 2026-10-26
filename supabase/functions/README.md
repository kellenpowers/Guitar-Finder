# Cloud functions (Supabase project: flip-finder, ref xcwhcpithgcommwqpgif)

Version-controlled source for the two edge functions that power the phone
site. The DEPLOYED copies embed real secret values where these files have
`REPLACED_AT_DEPLOY` placeholders — Claude substitutes them when deploying
via the connected Supabase tools. Never commit real values (CLAUDE.md rule 3).

- `publish/` — POST endpoint the studio computer pushes snapshots to,
  guarded by the `x-publish-key` header (pairs with PUBLISH_KEY in .env).
- `snapshot/` — GET endpoint the phone/web app reads, guarded by the
  `?code=` passcode the owner types on each device.

To rotate a secret: pick a new value, redeploy the function with it
substituted, and update the matching side (.env for PUBLISH_KEY; tell the
owner the new passcode for snapshot).

## Pending deploy (do this when the Supabase connection is available)

The repricing autopilot (Oct 26 2026) needs, in this order:

1. Migration — new inventory columns:
   `alter table inventory add column if not exists auto_reprice boolean not null default true,
    add column if not exists repriced_at timestamptz,
    add column if not exists initial_price numeric,
    add column if not exists views integer,
    add column if not exists watches integer;`
2. Redeploy `inventory/` (v8) from this repo copy — it whitelists those
   columns and the `revise_price` command kind.

Until both land, the phone's "Push price" button reports that the cloud
needs an update, and the Mac's engagement/autopilot writes are dropped
harmlessly by the v7 whitelist. Remove this section once deployed.
