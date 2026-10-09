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
