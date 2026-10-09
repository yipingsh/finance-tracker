// The limits enforced in the database: monthly per-user limit, global daily cap, one run at a
// time, and stale-run cleanup. Includes race tests that fire requests in parallel.
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { admin, connectDb, finish, insertUser, raiseGlobalCap, reserve } from './helpers'

let db: pg.Pool
let restoreCap: () => Promise<unknown>

beforeAll(async () => {
  db = await connectDb()
  restoreCap = await raiseGlobalCap(db)
})
beforeEach(() => db.query('delete from private.daily_spend'))
afterAll(async () => {
  await db.query('delete from private.daily_spend')
  await restoreCap()
  await db.end()
})

async function uploadsUsed(userId: string): Promise<number> {
  const { rows } = await db.query('select coalesce(sum(uploads), 0)::int as n from private.usage_monthly where user_id = $1', [userId])
  return rows[0].n
}

describe('monthly upload limit', () => {
  it('allows exactly the monthly limit, then rejects', async () => {
    const user = await insertUser(db)
    for (let i = 1; i <= 3; i++) {
      const { data, error } = await reserve(user)
      expect(error).toBeNull()
      expect(data?.uploads_used).toBe(i)
      await finish(data!.run_id, 0.01, true)
    }
    const fourth = await reserve(user)
    expect(fourth.error?.message).toBe('monthly_quota_exceeded')
    expect(await uploadsUsed(user)).toBe(3)
  })

  it('gives the upload back only if a failed run spent nothing', async () => {
    const user = await insertUser(db)
    const a = (await reserve(user)).data!
    await finish(a.run_id, 0, false) // failed before reaching Claude
    expect(await uploadsUsed(user)).toBe(0)

    const b = (await reserve(user)).data!
    await finish(b.run_id, 0.2, false) // failed after spending tokens: still counts
    expect(await uploadsUsed(user)).toBe(1)
  })

  it('finishing a run twice does not count its cost twice', async () => {
    const user = await insertUser(db)
    const run = (await reserve(user)).data!
    await finish(run.run_id, 0.3, true)
    await finish(run.run_id, 0.3, true)
    const { rows } = await db.query('select cost_usd from private.daily_spend')
    expect(Number(rows[0].cost_usd)).toBeCloseTo(0.3)
  })

  it('rejects zero or negative cost estimates', async () => {
    const user = await insertUser(db)
    expect((await reserve(user, 0)).error?.message).toBe('invalid_estimate')
    expect((await reserve(user, -1)).error?.message).toBe('invalid_estimate')
  })
})

describe('one run at a time', () => {
  it('rejects a second run while one is in progress, without charging for it', async () => {
    const user = await insertUser(db)
    expect((await reserve(user)).error).toBeNull()
    expect((await reserve(user)).error?.message).toBe('run_in_progress')
    expect(await uploadsUsed(user)).toBe(1) // the rejected attempt was rolled back
  })

  it('race: 20 simultaneous uploads from one user -> exactly 1 accepted', async () => {
    const user = await insertUser(db)
    const results = await Promise.all(Array.from({ length: 20 }, () => reserve(user)))
    expect(results.filter((r) => !r.error)).toHaveLength(1)
    expect(await uploadsUsed(user)).toBe(1)
  })

  it('a run whose function crashed expires after the timeout and is charged its full estimate', async () => {
    const user = await insertUser(db)
    const stuck = (await reserve(user, 0.4)).data!
    await db.query(`update private.runs set started_at = now() - interval '11 minutes' where id = $1`, [stuck.run_id])

    expect((await reserve(user, 0.4)).error).toBeNull()
    const { rows } = await db.query('select status, actual_usd from private.runs where id = $1', [stuck.run_id])
    expect(rows[0].status).toBe('expired')
    expect(Number(rows[0].actual_usd)).toBeCloseTo(0.4)
  })
})

describe('insight summaries have their own monthly limit', () => {
  const reserveInsight = (userId: string) =>
    admin.rpc('reserve_run', { p_user_id: userId, p_kind: 'insight', p_estimated_usd: 0.1 }).single<{ run_id: string; used: number; monthly_limit: number }>()

  it('counts insights separately from uploads and stops at the limit', async () => {
    const user = await insertUser(db)
    for (let i = 1; i <= 3; i++) {
      const { data, error } = await reserveInsight(user)
      expect(error).toBeNull()
      await finish(data!.run_id, 0.01, true)
    }
    expect((await reserveInsight(user)).error?.message).toBe('monthly_quota_exceeded')
    expect(await uploadsUsed(user)).toBe(0) // uploads untouched
    expect((await reserve(user)).error).toBeNull() // and still available
  })

  it('refunds a failed, cost-free insight to the insight counter', async () => {
    const user = await insertUser(db)
    const run = (await reserveInsight(user)).data!
    await finish(run.run_id, 0, false)
    const { rows } = await db.query('select insights, uploads from private.usage_monthly where user_id = $1', [user])
    expect(rows[0]).toEqual({ insights: 0, uploads: 0 })
  })

  it('rejects unknown run kinds', async () => {
    const user = await insertUser(db)
    const { error } = await admin.rpc('reserve_run', { p_user_id: user, p_kind: 'free_stuff', p_estimated_usd: 0.1 })
    expect(error?.message).toBe('invalid_kind')
  })
})

describe('global daily spending cap', () => {
  it('rejects once the cap would be exceeded, and rolls back the user’s upload count', async () => {
    await db.query('update private.limits set global_daily_cap_usd = 0.75')
    try {
      const a = await insertUser(db)
      const b = await insertUser(db)
      expect((await reserve(a, 0.5)).error).toBeNull()
      expect((await reserve(b, 0.5)).error?.message).toBe('global_daily_cap_reached')
      expect(await uploadsUsed(b)).toBe(0)
    } finally {
      await db.query('update private.limits set global_daily_cap_usd = 1000')
    }
  })

  it('race: 10 users at once against a $2 cap at $0.50 each -> exactly 4 accepted', async () => {
    await db.query('update private.limits set global_daily_cap_usd = 2')
    try {
      const users = await Promise.all(Array.from({ length: 10 }, () => insertUser(db)))
      const results = await Promise.all(users.map((u) => reserve(u, 0.5)))
      expect(results.filter((r) => !r.error)).toHaveLength(4)
      const { rows } = await db.query('select reserved_usd from private.daily_spend')
      expect(Number(rows[0].reserved_usd)).toBeCloseTo(2)
    } finally {
      await db.query('update private.limits set global_daily_cap_usd = 1000')
    }
  })
})
