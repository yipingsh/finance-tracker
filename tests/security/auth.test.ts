import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { browserClient, CAPTCHA_TOKEN } from './helpers'

describe('sign-in', () => {
  it('rejects an anonymous sign-in without a Turnstile token (bots blocked)', async () => {
    const { data, error } = await browserClient().auth.signInAnonymously()
    expect(error).not.toBeNull()
    expect(data.session).toBeNull()
  })

  it('creates an anonymous session with no email or personal data when the bot check passes', async () => {
    const { data, error } = await browserClient().auth.signInAnonymously({ options: { captchaToken: CAPTCHA_TOKEN } })
    expect(error).toBeNull()
    expect(data.user?.is_anonymous).toBe(true)
    expect(data.user?.email ?? '').toBe('')
  })

  it('does not allow email sign-ups (anonymous is the only way in)', async () => {
    const { data, error } = await browserClient().auth.signUp({
      email: `attacker-${randomUUID()}@example.test`,
      password: randomUUID(),
      options: { captchaToken: CAPTCHA_TOKEN },
    })
    expect(error).not.toBeNull()
    expect(data.user).toBeNull()
  })
})
