// Shared setup for the security tests. Runs against the LOCAL Supabase stack only:
// keys come from `supabase status`, never from a hardcoded or production value.
import { execSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import pg from 'pg'

function loadLocalEnv(): Record<string, string> {
  const out = execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const env: Record<string, string> = {}
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
    if (m) env[m[1]] = m[2]
  }
  if (!env.API_URL?.startsWith('http://127.0.0.1')) throw new Error('Security tests only run against local Supabase')
  return env
}

export const env = loadLocalEnv()
export const FUNCTION_URL = `${env.FUNCTIONS_URL}/process-statement`

// The dummy token produced by Cloudflare's Turnstile test site keys; accepted by the
// always-pass test secret configured in supabase/.env.
export const CAPTCHA_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } }

export const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, noPersist)

/** What a browser gets: the public publishable key and nothing else. */
export const browserClient = (): SupabaseClient => createClient(env.API_URL, env.PUBLISHABLE_KEY, noPersist)

/**
 * A signed-in browser session, created exactly like the app does it. Each call uses one of the
 * per-IP anonymous sign-ins (rate limited in config.toml), so test files share users where they can.
 */
export async function signedInUser() {
  const client = browserClient()
  const { data, error } = await client.auth.signInAnonymously({ options: { captchaToken: CAPTCHA_TOKEN } })
  if (error) throw error
  return { client, userId: data.user!.id, accessToken: data.session!.access_token }
}

export async function connectDb(): Promise<pg.Pool> {
  // A pool, so parallel test setup queries run concurrently instead of queueing on one connection.
  return new pg.Pool({ connectionString: env.DB_URL, max: 20 })
}

/** A bare auth user for database-level tests (no session needed). */
export async function insertUser(db: pg.Pool): Promise<string> {
  const { rows } = await db.query(
    `insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, now(), now())
     returning id`,
  )
  return rows[0].id
}

export async function reserve(userId: string, estimatedUsd = 0.5) {
  return admin.rpc('reserve_upload', { p_user_id: userId, p_estimated_usd: estimatedUsd }).single<{
    run_id: string
    uploads_used: number
    uploads_limit: number
  }>()
}

export async function finish(runId: string, actualUsd: number, succeeded: boolean) {
  const { error } = await admin.rpc('finish_run', { p_run_id: runId, p_actual_usd: actualUsd, p_succeeded: succeeded })
  if (error) throw error
}

/**
 * Tests share one local database, so the global daily cap is raised while they run (otherwise
 * earlier tests' reservations would trip it) and restored afterwards.
 */
export async function raiseGlobalCap(db: pg.Pool) {
  const { rows } = await db.query('select global_daily_cap_usd from private.limits')
  const original = rows[0].global_daily_cap_usd as string
  await db.query('update private.limits set global_daily_cap_usd = 1000')
  return () => db.query('update private.limits set global_daily_cap_usd = $1', [original])
}
