// What a browser can and cannot reach in the database, using only the public key and its own session.
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { browserClient, connectDb, insertUser, raiseGlobalCap, reserve, signedInUser } from './helpers'

let db: pg.Pool
let restoreCap: () => Promise<unknown>
let user: Awaited<ReturnType<typeof signedInUser>>

beforeAll(async () => {
  db = await connectDb()
  restoreCap = await raiseGlobalCap(db)
  user = await signedInUser()
})
afterAll(async () => {
  await restoreCap()
  await db.end()
})

describe('browser access to the database', () => {
  it('a visitor without a session cannot read any quota', async () => {
    const { error } = await browserClient().rpc('get_my_quota')
    expect(error?.code).toBe('42501') // permission denied
  })

  it('a signed-in user can read their own quota', async () => {
    const { data, error } = await user.client.rpc('get_my_quota').single()
    expect(error).toBeNull()
    expect(data).toEqual({ uploads_used: 0, uploads_limit: 3, insights_used: 0, insights_limit: 6, service_available: true })
  })

  it("another user's usage never shows up in your quota", async () => {
    const other = await insertUser(db)
    expect((await reserve(other)).error).toBeNull()
    const { data } = await user.client.rpc('get_my_quota').single<{ uploads_used: number }>()
    expect(data?.uploads_used).toBe(0)
  })

  it('a signed-in user cannot grant themselves uploads or settle runs', async () => {
    const reserved = await user.client.rpc('reserve_upload', { p_user_id: user.userId, p_estimated_usd: 0.5 })
    expect(reserved.error?.code).toBe('42501')
    const finished = await user.client.rpc('finish_run', {
      p_run_id: crypto.randomUUID(),
      p_actual_usd: 0,
      p_succeeded: false,
    })
    expect(finished.error?.code).toBe('42501')
    const run = await user.client.rpc('reserve_run', { p_user_id: user.userId, p_kind: 'insight', p_estimated_usd: 0.1 })
    expect(run.error?.code).toBe('42501')
  })

  it('the usage tables are not reachable through the API at all', async () => {
    for (const table of ['usage_monthly', 'daily_spend', 'runs', 'limits']) {
      const { data, error } = await user.client.schema('private').from(table).select('*')
      expect(error, table).not.toBeNull()
      expect(data, table).toBeNull()
    }
  })
})
