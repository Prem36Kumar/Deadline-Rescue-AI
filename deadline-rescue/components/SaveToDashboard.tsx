'use client'
import { useState } from 'react'
import type { DeadlineResult } from '@/lib/schema'
import { saveDeadline } from '@/lib/storage'

export default function SaveToDashboard({ result }: { result: DeadlineResult }) {
  const [saved, setSaved] = useState(false)
  function handleSave() {
    saveDeadline({ ...result, id: `${Date.now()}`, saved_at: new Date().toISOString() })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  return (
    <button onClick={handleSave} className="w-full py-2.5 rounded-xl text-xs font-semibold transition-all"
      style={{ border: '1px solid rgba(124,111,255,.3)', background: saved ? 'var(--accent-dim)' : 'transparent', color: 'var(--accent)' }}>
      {saved ? '✓ Saved to Dashboard' : '📊 Save to Dashboard'}
    </button>
  )
}
