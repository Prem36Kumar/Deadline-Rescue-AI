'use client'
import { useEffect, useState } from 'react'
import type { SavedDeadline } from '@/lib/dashboard-types'
import { getSavedDeadlines, removeDeadline } from '@/lib/storage'

const URGENCY_COLOR: Record<string, string> = { Critical: '#ff4466', High: '#ff8c42', Medium: '#ffd166', Low: '#06d6a0' }

function timeLeft(iso: string | null) {
  if (!iso) return '—'
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'Overdue'
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export default function Dashboard() {
  const [deadlines, setDeadlines] = useState<SavedDeadline[]>([])
  const [, setTick] = useState(0)

  useEffect(() => {
    setDeadlines(getSavedDeadlines())
    const interval = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(interval)
  }, [])

  const sorted = [...deadlines].sort((a, b) => {
    const ta = a.deadline_iso ? new Date(a.deadline_iso).getTime() : Infinity
    const tb = b.deadline_iso ? new Date(b.deadline_iso).getTime() : Infinity
    return ta - tb
  })

  function handleRemove(id: string) { setDeadlines(removeDeadline(id)) }

  return (
    <main className="min-h-screen py-10 px-4" style={{ background: 'var(--bg)' }}>
      <div className="max-w-3xl mx-auto flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>📊 Mission Control</h1>
            <p className="text-sm" style={{ color: 'var(--text2)' }}>Every deadline you&rsquo;re tracking, live.</p>
          </div>
          <a href="/" className="text-xs px-3 py-2 rounded-xl font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--text2)' }}>← New deadline</a>
        </div>

        {sorted.length === 0 ? (
          <div className="rounded-2xl p-10 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="text-sm" style={{ color: 'var(--text3)' }}>Nothing saved yet. Analyze a deadline and tap &ldquo;Save to Dashboard.&rdquo;</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {sorted.map((d) => {
              const color = URGENCY_COLOR[d.urgency_level] ?? '#7c6fff'
              return (
                <div key={d.id} className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: 'var(--surface)', border: `1px solid ${color}44` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{d.task_name}</p>
                    <button onClick={() => handleRemove(d.id)} className="text-xs" style={{ color: 'var(--text3)' }}>✕</button>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text3)' }}>{d.category} · {d.deadline_text}</p>
                  <p className="text-xl font-bold" style={{ color }}>{timeLeft(d.deadline_iso)}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
