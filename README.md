# Sentinel Evidence Platform

A consent-first incident evidence workspace built with HTML, CSS, vanilla JavaScript, Supabase, and Netlify. It is designed for authorized device owners and investigators. It does not activate sensors or request location until a visitor chooses the relevant control.

## Current implementation

- Supabase Auth administrator login, password recovery, and role checks.
- Case creation, editing, status changes, and archiving.
- Single-view secure evidence links with expiration and activation controls.
- Server-recorded visits, technical metadata, and optional IP-geolocation estimates.
- Separate permission controls for GPS, camera, microphone, and written statements.
- Visible GPS sessions with stop controls, private image/audio uploads, and SHA-256 integrity hashes.
- RLS-protected evidence records, private Storage buckets, signed downloads, and administrative audit records.
- Searchable cases, visits, and evidence; live Supabase Realtime refresh; Leaflet location map; Chart.js visit chart; PDF police-report generator; and structured JSON case export.
- Netlify static build and routing configuration.

Location and browser metadata are technical records, not proof of a visitor's identity. IP-derived locations are estimates. Sensor behavior, file uploads, database access, and authentication require a configured Supabase project and must be verified there before production use.

## Requirements

- Node.js 20 or newer for the static build.
- A Supabase project with Auth, PostgreSQL, Storage, and Edge Functions enabled.
- Supabase CLI for migrations and function deployment.
- A Netlify site for hosting.
- Optional: an IP-geolocation provider with a JSON response containing `country`, `region`, `city`, `latitude`, and `longitude`. It must accept the requested IP in an `ip` query parameter and a bearer API key.

## Local frontend setup

1. Copy `.env.example` to `.env` and set `SUPABASE_URL` and `SUPABASE_ANON_KEY`, or provide them in the shell. The build reads only those two public values from `.env`; do not commit `.env`.
2. The browser receives these public values only; never place a service-role key in `.env` or frontend configuration.
3. Run:

   ```sh
   npm run build
   ```

4. Serve the generated `dist` directory over HTTPS or localhost. The public evidence route is `/evidence/<token>`.

Without public Supabase configuration, the build intentionally displays a setup notice rather than fake data. Production builds fail unless both public Supabase values are set.

## Supabase setup

1. Create a Supabase project and keep its service-role key private.
2. Apply the migration:

   ```sh
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

3. Create an administrator through Supabase Auth (invite the intended administrator; do not expose a public sign-up form). After the `profiles` row is created, grant the role from the Supabase SQL Editor:

   ```sql
   update public.profiles
   set role = 'admin', full_name = 'Administrator'
   where id = (
     select id from auth.users where email = 'admin@example.com'
   );
   ```

   Confirm that exactly one row changed. Accounts created by Auth otherwise receive the non-privileged `pending` role.

4. Set Edge Function secrets in Supabase, not in Netlify:

   ```sh
   supabase secrets set ALLOWED_ORIGINS=https://YOUR_SITE.netlify.app
   ```

   For a custom domain, list each exact allowed origin separated by commas. To enable estimated IP locations, set `IP_GEOLOCATION_URL` and `IP_GEOLOCATION_API_KEY`. The provider key is sent only by Edge Functions.

5. Deploy the Edge Functions:

   ```sh
   supabase functions deploy generate-evidence-link
   supabase functions deploy manage-evidence-link
   supabase functions deploy validate-evidence-link
   supabase functions deploy record-visit
   supabase functions deploy lookup-ip-intelligence
   supabase functions deploy create-consent-record
   supabase functions deploy start-location-session
   supabase functions deploy save-location-record
   supabase functions deploy end-location-session
   supabase functions deploy submit-evidence
   supabase functions deploy complete-evidence-upload
   supabase functions deploy submit-written-evidence
   supabase functions deploy generate-police-report
   supabase functions deploy export-case-evidence
   ```

6. Configure Supabase Auth's site URL and redirect allowlist for the Netlify origin and local development origin. Configure a production SMTP provider before relying on password recovery.
7. Verify the three evidence buckets remain private. The migration adds private bucket policies and administrators can create one-minute signed download URLs. The migration also adds the dashboard tables to `supabase_realtime` when that publication exists.

## Netlify setup

1. Connect the selected GitHub repository after confirming the repository and production branch.
2. Configure `SUPABASE_URL` and `SUPABASE_ANON_KEY` as Netlify build environment variables. These are the public project URL and publishable/anon key only.
3. Set the build command to `npm run build` and publish directory to `dist` (already configured in `netlify.toml`).
4. Do not configure `SUPABASE_SERVICE_ROLE_KEY` or the IP-geolocation API key in frontend/build variables. Configure them only as Supabase Edge Function secrets.
5. Add the final Netlify/custom-domain origin to `ALLOWED_ORIGINS` in Supabase and to Supabase Auth redirect URLs.

No repository, Supabase project, Netlify site, or production URL is connected by this source tree. Connecting or deploying requires the owner's account access and explicit repository selection.

## Security notes

- All sensitive database tables have RLS enabled. Administrator role is read from the protected `profiles` table.
- Public functions validate a one-time-shown random link token by its SHA-256 hash and bind each submission to that link and its visit.
- Privileged database and storage access uses the service-role key only inside Edge Functions.
- Images and audio use short-lived signed upload capabilities and are stored in private buckets. Public access to evidence objects is not enabled.
- Uploads are limited by size, MIME allowlist, and file-signature checks. Original uploaded bytes are retained; the server stores their SHA-256 hash.
- GPS uses browser permission and visible foreground `watchPosition`; users can stop the session. Browsers may stop updates if a page closes, and the platform does not claim background tracking.
- The report/export endpoints return structured case records. JSON exports contain private file links that expire after 60 seconds; handle exports as sensitive material.
- IP intelligence is optional. If no provider is configured, estimated location fields remain unavailable.
- Retention duration, organization identity, legal basis, jurisdictional privacy notices, and provider-specific data processing terms must be configured by the operator before deployment.

## Verification

Run the local static checks:

```sh
npm run build
node --check js/app.js
node --check scripts/build.mjs
```

The Supabase migration, RLS behavior, browser permission flows, uploads/downloads, Auth, and Edge Functions must be tested against a configured Supabase project. No production service credentials are present in this repository, so live integration and deployment results must not be inferred from a local build.
