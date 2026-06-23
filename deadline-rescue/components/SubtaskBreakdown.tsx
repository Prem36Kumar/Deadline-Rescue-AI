'use client'
import { useState, useEffect } from 'react'
import type { DeadlineResult } from '@/lib/schema'

interface Subtask { step: string; detail: string; time_estimate_minutes: number }

export default function SubtaskBreakdown({
  result,
  prefetchedSubtasks,
}: {
  result: DeadlineResult
  prefetchedSubtasks?: any[] | null
}) {
  const [loading, setLoading] = useState(!prefetchedSubtasks)
  const [error, setError] = useState('')
  const [subtasks, setSubtasks] = useState<Subtask[] | null>(prefetchedSubtasks ?? null)
  const [done, setDone] = useState<Record<number, boolean>>({})

  useEffect(() => {
    if (prefetchedSubtasks) { setSubtasks(prefetchedSubtasks); setLoading(false) }
  }, [prefetchedSubtasks])

  async function breakdown() {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/breakdown', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_name: result.task_name, category: result.category, deadline_text: result.deadline_text, consequence: result.consequence }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) { setError(json.message ?? 'Could not break this down.'); return }
      setSubtasks(json.data.subtasks)
    } catch { setError('Network error while generating steps.') } finally { setLoading(false) }
  }

  const totalMinutes = subtasks?.reduce((sum, s) => sum + s.time_estimate_minutes, 0) ?? 0

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="font-mono text-xs uppercase tracking-widest" style={{ color: 'var(--text3)' }}>
          🧩 Smart step-by-step plan
          {loading && <span style={{ color: 'var(--accent)', marginLeft: 8 }}>⟳ AI building your plan…</span>}
        </p>
        {!subtasks && !loading && (
          <button onClick={breakdown} className="text-xs px-3 py-1.5 rounded-full font-semibold"
            style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-glow)', color: 'var(--accent)' }}>
            Break into steps
          </button>
        )}
      </div>
      {error && <p className="text-xs mb-2" style={{ color: '#ff8899' }}>{error}</p>}
      {loading && (
        <div className="flex flex-col gap-2">
          {[1,2,3].map(i => (
            <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: 'var(--surface2)', opacity: 1 - i * 0.2 }} />
          ))}
        </div>
      )}
      {subtasks && (
        <div className="flex flex-col gap-2">
          <p className="text-xs" style={{ color: 'var(--text3)' }}>~{totalMinutes} min total</p>
          {subtasks.map((s, i) => (
            <label key={i} className="flex items-start gap-2.5 p-3 rounded-lg cursor-pointer"
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', opacity: done[i] ? 0.55 : 1 }}>
              <input type="checkbox" checked={!!done[i]} onChange={() => setDone(d => ({ ...d, [i]: !d[i] }))} className="mt-0.5" />
              <span>
                <span className="text-sm font-semibold block" style={{ color: 'var(--text)', textDecoration: done[i] ? 'line-through' : 'none' }}>
                  {i + 1}. {s.step} <span className="text-xs font-normal" style={{ color: 'var(--text3)' }}>({s.time_estimate_minutes} min)</span>
                </span>
                <span className="text-xs" style={{ color: 'var(--text2)' }}>{s.detail}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
