import { useEffect, useRef } from 'react'

// Cloudflare Turnstile: a bot check that usually needs no interaction. The token it returns is
// verified by Supabase Auth (server side) before an anonymous session is created.

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile missing')))
    script.onerror = () => reject(new Error('Could not load the bot check'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

export function Turnstile({ onToken, onError }: { onToken: (token: string) => void; onError: (e: Error) => void }) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let widgetId: string | undefined
    let cancelled = false
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !container.current) return
        widgetId = turnstile.render(container.current, {
          sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
          callback: onToken,
          'error-callback': () => onError(new Error('The bot check failed. Refresh the page to try again.')),
        })
      })
      .catch(onError)
    return () => {
      cancelled = true
      if (widgetId) window.turnstile?.remove(widgetId)
    }
  }, [onToken, onError])

  return <div ref={container} />
}
