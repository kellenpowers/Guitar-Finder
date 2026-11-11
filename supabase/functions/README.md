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

1. Security (from Supabase's Nov 8 2026 advisor email — the other tables
   already have this): `ALTER TABLE "public"."ignores" ENABLE ROW LEVEL SECURITY;`
   (our functions use the service key, which bypasses RLS — nothing breaks).
2. Redeploy `inventory/` (v9) from this repo copy — adds the `end_listings`
   command kind (owner-tapped takedown after a sale the watcher can't see).

Until v9 lands, marking a live item sold on the phone reports that the cloud
needs an update (status is left unchanged). Remove this section once deployed.

