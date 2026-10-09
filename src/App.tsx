import { useState } from 'react'
import { Turnstile } from './auth/Turnstile'
import { useAnonymousSession } from './auth/useAnonymousSession'
import { Icon, type IconName } from './components/icons'
import { BudgetsView } from './features/budgets/BudgetsView'
import { Overview } from './features/dashboard/Overview'
import { StatementsView } from './features/statements/StatementsView'
import { SubscriptionsView } from './features/subscriptions/SubscriptionsView'
import { TransactionsView } from './features/transactions/TransactionsView'
import { UploadView } from './features/upload/UploadView'
import { savedMode, type Mode } from './lib/db'
import { enterDemo, exitDemo, resetDemo } from './lib/demo'

type Tab = 'Overview' | 'Transactions' | 'Subscriptions' | 'Budgets' | 'Statements' | 'Upload'
const TABS: { name: Tab; icon: IconName; subtitle: string }[] = [
  { name: 'Overview', icon: 'overview', subtitle: '' },
  { name: 'Transactions', icon: 'transactions', subtitle: 'Every transaction from your statements. Change a category and future uploads follow.' },
  { name: 'Subscriptions', icon: 'subscriptions', subtitle: 'Recurring payments found across your statements.' },
  { name: 'Budgets', icon: 'budgets', subtitle: 'Monthly limits per spending category.' },
  { name: 'Statements', icon: 'statements', subtitle: 'Every statement you uploaded and how its numbers were checked.' },
  { name: 'Upload', icon: 'upload', subtitle: 'Add a statement from any bank, card or e-wallet.' },
]

function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-(--brand-900) text-white">
        <Icon name="logo" />
      </span>
      <span className="font-semibold tracking-tight">Finance Tracker</span>
    </span>
  )
}

export default function App() {
  const { state, onToken, onError } = useAnonymousSession()
  const [tab, setTab] = useState<Tab>('Overview')
  const [month, setMonth] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>(savedMode())
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')

  async function changeMode(next: 'demo' | 'real' | 'reset') {
    setSwitching(true)
    setError('')
    try {
      if (next === 'demo') await enterDemo()
      else if (next === 'reset') await resetDemo()
      else exitDemo()
      setMode(next === 'real' ? 'real' : 'demo')
      setMonth(null)
      setTab('Overview')
    } catch (e) {
      setError((e as Error).message)
      exitDemo()
      setMode('real')
    } finally {
      setSwitching(false)
    }
  }

  const ready = state.status === 'ready'
  const current = TABS.find((t) => t.name === tab)!

  const demoControls = ready && (
    mode === 'real' ? (
      <button onClick={() => changeMode('demo')} disabled={switching} className="w-full rounded-lg border border-(--border) bg-(--surface-2) px-3 py-1.5 text-sm font-medium hover:bg-(--surface-3) disabled:opacity-50">
        Try the demo
      </button>
    ) : (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
        <p className="font-medium text-amber-900">Demo mode</p>
        <p className="mt-0.5 text-xs text-amber-900/80">Sample statements processed by the real agents. Your own data is untouched.</p>
        <div className="mt-2 flex gap-3 text-xs font-medium">
          <button onClick={() => changeMode('reset')} disabled={switching} className="text-amber-900 hover:underline">Reset</button>
          <button onClick={() => changeMode('real')} disabled={switching} className="text-amber-900 hover:underline">Exit demo</button>
        </div>
      </div>
    )
  )

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-(--border) bg-(--surface-2) px-3 py-5 lg:flex">
        <div className="px-2"><Logo /></div>
        {ready && (
          <nav className="mt-8 space-y-0.5" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.name}
                onClick={() => setTab(t.name)}
                aria-current={tab === t.name ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${tab === t.name ? 'bg-(--accent-soft) font-medium text-(--accent)' : 'text-(--text-2) hover:bg-(--surface-3) hover:text-(--text-1)'}`}
              >
                <Icon name={t.icon} />
                {t.name}
              </button>
            ))}
          </nav>
        )}
        <div className="mt-auto space-y-4">
          {demoControls}
          <p className="flex gap-2 px-1 text-xs text-(--text-3)">
            <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Statements are read by Claude and never stored on a server. Your data stays in this browser.
          </p>
        </div>
      </aside>

      {/* Top bar (mobile) */}
      <header className="sticky top-0 z-10 border-b border-(--border) bg-(--surface-2) lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Logo />
          {ready && mode === 'real' && (
            <button onClick={() => changeMode('demo')} disabled={switching} className="rounded-lg border border-(--border) px-3 py-1 text-sm font-medium">Try the demo</button>
          )}
          {ready && mode === 'demo' && (
            <button onClick={() => changeMode('real')} disabled={switching} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1 text-sm font-medium text-amber-900">Exit demo</button>
          )}
        </div>
        {ready && (
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.name}
                onClick={() => setTab(t.name)}
                aria-current={tab === t.name ? 'page' : undefined}
                className={`whitespace-nowrap rounded-md px-3 py-1 text-sm ${tab === t.name ? 'bg-(--accent-soft) font-medium text-(--accent)' : 'text-(--text-2)'}`}
              >
                {t.name}
              </button>
            ))}
          </nav>
        )}
      </header>

      <main className="min-w-0 px-4 py-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">
          {error && <p className="card mb-4 rounded-xl p-4 text-sm text-(--critical)">{error}</p>}
          {(state.status === 'loading' || switching) && <div className="card rounded-xl p-6 text-(--text-2)">Loading…</div>}
          {state.status === 'needs-bot-check' && (
            <div className="card rounded-xl p-6">
              <p>Checking you're not a bot…</p>
              <Turnstile onToken={onToken} onError={onError} />
            </div>
          )}
          {state.status === 'error' && <div className="card rounded-xl p-6 text-(--critical)">{state.message}</div>}

          {ready && !switching && (
            // Keyed by mode so every view re-subscribes to the right database after a switch.
            <div key={mode}>
              {tab === 'Overview' ? (
                <Overview month={month} onMonth={setMonth} onUpload={() => setTab('Upload')} onDemo={() => changeMode('demo')} onViewTransactions={() => setTab('Transactions')} demo={mode === 'demo'} />
              ) : (
                <>
                  <div className="mb-6">
                    <h1 className="text-2xl font-semibold tracking-tight">{current.name}</h1>
                    <p className="mt-1 text-sm text-(--text-2)">{current.subtitle}</p>
                  </div>
                  {tab === 'Transactions' && <TransactionsView month={month} />}
                  {tab === 'Subscriptions' && <SubscriptionsView />}
                  {tab === 'Budgets' && <BudgetsView month={month} />}
                  {tab === 'Statements' && <StatementsView />}
                  {tab === 'Upload' && <UploadView demo={mode === 'demo'} onDone={() => setTab('Overview')} />}
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
