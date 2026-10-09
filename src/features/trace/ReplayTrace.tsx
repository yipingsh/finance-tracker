import { useEffect, useState } from 'react'
import type { TraceEvent } from '../../lib/processStatement'
import { TracePanel } from './TracePanel'

/** Plays a recorded trace back with its original timing (sped up), as if the agents were running now. */
export function ReplayTrace({ events, speed = 2 }: { events: TraceEvent[]; speed?: number }) {
  const [shown, setShown] = useState(0)
  const [run, setRun] = useState(0)

  // Callers key this component by run, so a different recording starts from zero.
  useEffect(() => {
    const timers = events.map((e, i) => setTimeout(() => setShown(i + 1), e.t / speed))
    return () => timers.forEach(clearTimeout)
  }, [events, speed, run])

  const done = shown >= events.length
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-(--text-2)">
        <span>Replaying a recorded run at {speed}× speed. No AI calls are made.</span>
        {done && (
          <button onClick={() => { setShown(0); setRun((r) => r + 1) }} className="text-(--link) hover:underline">
            Replay again
          </button>
        )}
      </div>
      <TracePanel events={events.slice(0, shown)} running={!done} />
    </div>
  )
}
