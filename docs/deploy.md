# Deploying

The app has two halves:

- **Frontend** (React, static files) → **Cloudflare Pages**
- **Backend** (Postgres for quotas, anonymous auth, two Edge Functions) → **hosted Supabase**

Financial data never touches either: it lives in each user's browser.

Secrets (Anthropic key, Supabase secret key, Turnstile secret) are only ever pasted into the
Supabase and Cloudflare dashboards or the CLI on your machine, never into the repo or a chat.

## 0. Before you start

- [ ] All tests pass locally: `npx supabase start`, `npm run functions:serve`, then `npm test`
- [ ] Code is in a GitHub repo (Cloudflare Pages deploys from it). Check `git status` shows no
      `.env` files and no real statements before the first push.
- [ ] **Anthropic Console** → `finance-tracker` workspace → **monthly spend limit** set. This is the
      last line of defence if everything else fails.

## 1. Cloudflare Turnstile (bot check)

1. Cloudflare dashboard → Turnstile → **Add widget**.
2. Domains: your Pages domain (e.g. `finance-tracker.pages.dev`) and any custom domain.
3. Widget mode: **Managed** (usually invisible).
4. Keep the **site key** (public, goes in the frontend) and **secret key** (goes in Supabase, step 2).

## 2. Supabase project

1. Create a project at supabase.com, region **Singapore (ap-southeast-1)**. Separate from Inkling.
2. Link and push the database schema from this folder:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
   This applies everything in `supabase/migrations` (quota tables, functions, limits of 3 uploads
   and 6 summaries per user per month, and a US$3 global daily cap).
3. **Authentication → Sign In / Providers**:
   - Allow anonymous sign-ins: **on**
   - Email provider sign-ups: **off**
4. **Authentication → Attack Protection**: enable CAPTCHA, provider **Turnstile**, paste the
   Turnstile **secret key**.
5. **Authentication → Rate limits**: anonymous sign-ins per hour per IP, e.g. **30**.
6. **Authentication → URL configuration**: Site URL = your Pages URL.

   Configure auth in the dashboard. Don't run `supabase config push`: `config.toml` is set up for
   local development (it points at the Turnstile *test* secret).

7. Edge Function secrets (run on your machine; the key goes straight to Supabase):
   ```bash
   npx supabase secrets set ANTHROPIC_API_KEY=<your key>
   npx supabase secrets set ALLOWED_ORIGINS=https://finance-tracker.pages.dev
   ```
   Add a custom domain to `ALLOWED_ORIGINS` (comma-separated) if you use one.
   `SUPABASE_URL` and the service-role key are provided to functions automatically.
8. Deploy the functions:
   ```bash
   npx supabase functions deploy process-statement
   npx supabase functions deploy generate-insights
   ```
9. **Settings → API Keys**: copy the project URL and the **publishable** key (for step 3).

## 3. Cloudflare Pages (frontend)

1. Cloudflare dashboard → Workers & Pages → Create → Pages → **Connect to Git** → pick the repo.
2. Build settings: framework **Vite**, build command `npm run build`, output directory `dist`.
3. Environment variables (Production):
   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | the publishable key from Supabase |
   | `VITE_TURNSTILE_SITE_KEY` | the Turnstile site key |
   | `NODE_VERSION` | `24` |
4. Deploy. `public/_headers` is picked up automatically and sets the Content-Security-Policy and
   other security headers.

## 4. After the first deploy: checks

- [ ] Open the site in a private window: the bot check passes, the Overview shows, no errors in
      the browser console (especially no "Content Security Policy" violations).
- [ ] **Try the demo**: charts, replay and summary load.
- [ ] **CORS** (couldn't be tested locally, because the local gateway answers preflights itself):
      ```bash
      curl -si -X OPTIONS https://<project-ref>.supabase.co/functions/v1/process-statement -H "Origin: https://evil.example" -H "Access-Control-Request-Method: POST"
      ```
      The response should **not** include `Access-Control-Allow-Origin: https://evil.example`.
      Repeat with your Pages origin: that one should be allowed.
- [ ] Upload one real statement (~US$0.06) and check the trace, dashboard and summary.
- [ ] Anthropic Console shows the spend in the `finance-tracker` workspace.
- [ ] Supabase → Table editor → `private` schema (or SQL editor) shows the run in `private.runs`.

## Tuning later

Limits live in the `private.limits` table, editable in the SQL editor without a deploy:

```sql
update private.limits set monthly_uploads_per_user = 3, monthly_insights_per_user = 6, global_daily_cap_usd = 3;
```

## Updating

- Frontend: push to the main branch; Cloudflare Pages rebuilds.
- Database: add a new file in `supabase/migrations/` (never edit an applied one), then `npx supabase db push`.
- Functions: `npx supabase functions deploy <name>`.
- Demo data: `node scripts/build-demo.ts` locally (~US$0.25, needs the local stack), commit `public/demo/demo-data.json`.
