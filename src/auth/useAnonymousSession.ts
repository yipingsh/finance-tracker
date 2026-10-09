import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Invisible sign-in: no email, no password. A returning visitor reuses the session stored in
// this browser; a new visitor passes the Turnstile check and gets a random anonymous user id.

export type SessionState =
  | { status: 'loading' }
  | { status: 'needs-bot-check' }
  | { status: 'ready'; session: Session }
  | { status: 'error'; message: string }

let signingIn: Promise<Session> | null = null // guards against double sign-in (React StrictMode)

export function useAnonymousSession() {
  const [state, setState] = useState<SessionState>({ status: 'loading' })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState(data.session ? { status: 'ready', session: data.session } : { status: 'needs-bot-check' })
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setState({ status: 'ready', session })
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const onToken = useCallback((captchaToken: string) => {
    signingIn ??= supabase.auth.signInAnonymously({ options: { captchaToken } }).then(({ data, error }) => {
      if (error || !data.session) throw error ?? new Error('Sign-in failed')
      return data.session
    })
    signingIn
      .then((session) => setState({ status: 'ready', session }))
      .catch((e: Error) => {
        signingIn = null
        setState({ status: 'error', message: e.message })
      })
  }, [])

  const onError = useCallback((e: Error) => setState({ status: 'error', message: e.message }), [])

  return { state, onToken, onError }
}
