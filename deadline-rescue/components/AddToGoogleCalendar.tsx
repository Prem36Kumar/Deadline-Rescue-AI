'use client'

export default function AddToGoogleCalendar({
  taskName,
  deadlineIso,
  consequence,
  actionNow,
}: {
  taskName: string
  deadlineIso: string | null
  consequence: string
  actionNow: string
}) {
  if (!deadlineIso) return null

  function buildUrl() {
    const start = new Date(deadlineIso!)
    const end = new Date(start.getTime() + 30 * 60 * 1000)
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('.000', '')
    const details = `Consequence: ${consequence}\n\nAction: ${actionNow}`
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: `⏰ DEADLINE: ${taskName}`,
      dates: `${fmt(start)}/${fmt(end)}`,
      details,
      sf: 'true',
      output: 'xml',
    })
    return `https://calendar.google.com/calendar/render?${params.toString()}`
  }

  return (
    
      href={buildUrl()}
      target="_blank"
      rel="noopener noreferrer"
      className="w-full py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all"
      style={{
        border: '1px solid rgba(66,133,244,0.35)',
        background: 'rgba(66,133,244,0.07)',
        color: '#4285f4',
        textDecoration: 'none',
      }}
    >
      📅 Add to Google Calendar
    </a>
  )
}
