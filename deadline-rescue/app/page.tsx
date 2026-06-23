'use client'

import { useState, useRef, useEffect } from 'react'
import type { DeadlineResult, UrgencyLevel } from '@/lib/schema'
import SubtaskBreakdown from '@/components/SubtaskBreakdown'
import LeaveByMap from '@/components/LeaveByMap'
import SaveToDashboard from '@/components/SaveToDashboard'
import AddToGoogleCalendar from '@/components/AddToGoogleCalendar'

type InputMode = 'paste' | 'image'

const URGENCY_CONFIG: Record<UrgencyLevel, { color: string; bg: string; border: string; label: string; icon: string }> = {
  Critical: { color: '#ff4466', bg: 'rgba(255,68,102,.1)',  border: 'rgba(255,68,102,.28)',  label: 'Critical', icon: '🚨' },
  High:     { color: '#ff8c42', bg: 'rgba(255,140,66,.1)',  border: 'rgba(255,140,66,.28)',  label: 'Urgent',   icon: '⚡' },
  Medium:   { color: '#ffd166', bg: 'rgba(255,209,102,.1)', border: 'rgba(255,209,102,.28)', label: 'Plan Today', icon: '⚠' },
  Low:      { color: '#06d6a0', bg: 'rgba(6,214,160,.1)',   border: 'rgba(6,214,160,.28)',   label: 'On Track', icon: '✓' },
}

const DRAFT_LABEL: Record<string, string> = {
  extension_request: 'Extension Request', confirmation: 'Confirmation',
  payment_reminder: 'Payment Reminder', apology: 'Apology', none: '',
}

const CATEGORY_ICON: Record<string, string> = {
  'Assignment': '📚', 'Bill Payment': '💳', 'Interview': '💼', 'Meeting': '📅',
  'Exam': '📝', 'Job Application': '🎯', 'Subscription': '🔄', 'Other': '⏰',
}

const SAMPLES: Record<string, string> = {
  'Assignment email':
    'Dear student, your Computer Networks assignment (CN-304) must be submitted via the LMS portal by 11:59 PM on 25 June 2026. Late submissions will not be accepted and will receive zero marks. — Prof. Sharma, Dept. of CSE, VTU',
  'Electricity bill SMS':
    'Dear Customer, your BESCOM electricity bill of ₹1,847 is due on 27 June 2026. Pay now to avoid a ₹200 late fee and service disconnection. Pay at bescom.org or any UPI app. Bill No: 8472910.',
  'Interview WhatsApp':
    'Hi Prem, your technical interview for SDE-1 at Razorpay is scheduled for tomorrow (23 June) at 11:00 AM IST on Google Meet. Please confirm your availability by 9 PM tonight. Failure to confirm = slot cancelled.',
  'Exam registration':
    'IMPORTANT: VTU exam form for 6th sem must be filled online by 24 June 2026. Exam fee: ₹850. Students who miss this deadline will NOT be allowed to sit for semester exams. Fill at vtu.ac.in/examforms.',
  'Credit card SMS':
    'HDFC Bank: Your credit card bill of ₹12,450 is due on 26 June 2026. Pay before due date to avoid 40% p.a. interest charges and a ₹1,299 late fee. Pay now: hdfcbank.com/cards',
  'WhatsApp group':
    "Guys submit the project report to sir's email by tmrw 6pm ONLY!! No extensions he said 🙏 Still pending: Prem, Rahul, Kiran. Subject: [Group-7] Mini Project Report",
}

const LOADING_STEPS = [
  '🔍 Reading your message...',
  '🧠 Gemini is extracting the deadline...',
  '📊 Scoring urgency level...',
  '✍️ Drafting your response...',
  '✅ Almost done...',
]

function useCountdown(isoDate: string | null | undefined) {
  const [remaining, setRemaining] = useState('')
  useEffect(() => {
    if (!isoDate) { setRemaining(''); return }
    function tick() {
      const diff = new Date(isoDate!).getTime() - Date.now()
      if (diff <= 0) { setRemaining('OVERDUE'); return }
      const d = Math.floor(diff / 86400000)
      const h = Math.floor((diff % 86400000) / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setRemaining(d > 0 ? `${d}d ${h}h ${m}m ${s}s` : `${h}h ${m}m ${s}s`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [isoDate])
  return remaining
}

export default function Home() {
  const [inputMode, setInputMode]       = useState<InputMode>('paste')
  const [message, setMessage]           = useState('')
  const [imageFile, setImageFile]       = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [loading, setLoading]           = useState(false)
  const [loadingStep, setLoadingStep]   = useState(0)
  const [result, setResult]             = useState<DeadlineResult | null>(null)
  const [provider, setProvider]         = useState<string>('gemini')
  const [error, setError]               = useState('')
  const [isDragging, setIsDragging]     = useState(false)
  const [speaking, setSpeaking]         = useState(false)
  const [copied, setCopied]             = useState(false)
  const [draftOpen, setDraftOpen]       = useState(false)
  const [listening, setListening]       = useState(false)
  const [autoSubtasks, setAutoSubtasks] = useState<any[] | null>(null)

  const fileInputRef    = useRef<HTMLInputElement>(null)
  const cameraInputRef  = useRef<HTMLInputElement>(null)
  const loadingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const recognitionRef  = useRef<any>(null)

  const countdown = useCountdown(result?.deadline_iso)

  useEffect(() => {
    if (loading) {
      setLoadingStep(0)
      let step = 0
      loadingTimerRef.current = setInterval(() => {
        step = Math.min(step + 1, LOADING_STEPS.length - 1)
        setLoadingStep(step)
      }, 1200)
    } else if (loadingTimerRef.current) clearInterval(loadingTimerRef.current)
    return () => { if (loadingTimerRef.current) clearInterval(loadingTimerRef.current) }
  }, [loading])

  function handleImageFile(file: File) {
    if (!file.type.startsWith('image/')) { setError('Please upload an image file (PNG, JPG, WEBP)'); return }
    setImageFile(file); setResult(null); setError('')
    const reader = new FileReader()
    reader.onload = e => setImagePreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }
  function clearImage() { setImageFile(null); setImagePreview(null); setResult(null); setError('') }
  function imageToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = e => resolve((e.target?.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleImageFile(file)
  }

  function toggleVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { setError('Voice input not supported in this browser. Try Chrome.'); return }
    if (listening) { recognitionRef.current?.stop(); setListening(false); return }
    const recognition = new SR()
    recognitionRef.current = recognition
    recognition.lang = 'en-IN'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript
      setMessage(prev => prev ? prev + ' ' + transcript : transcript)
      setListening(false)
    }
    recognition.onerror = () => setListening(false)
    recognition.onend   = () => setListening(false)
    recognition.start()
    setListening(true)
  }

  async function analyzeDeadline() {
    const hasText  = inputMode === 'paste' && message.trim().length >= 10
    const hasImage = inputMode === 'image' && imageFile !== null
    if ((!hasText && !hasImage) || loading) return
    setLoading(true); setResult(null); setError(''); setDraftOpen(false)
    try {
      let body: Record<string, unknown>
      if (inputMode === 'image' && imageFile) {
        const base64 = await imageToBase64(imageFile)
        body = { image: base64, mediaType: imageFile.type }
      } else body = { message }
      const res  = await fetch('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok || !data.success) { setError(data.message ?? 'Something went wrong. Please try again.'); return }
      setResult(data.data)
      setProvider(data.provider ?? 'gemini')
      fetch('/api/breakdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_name: data.data.task_name,
          category: data.data.category,
          deadline_text: data.data.deadline_text,
          consequence: data.data.consequence,
        }),
      })
        .then(r => r.json())
        .then(bd => { if (bd.success) setAutoSubtasks(bd.data.subtasks) })
        .catch(() => {})
    } catch { setError('Network error — please check your connection and try again.') } finally { setLoading(false) }
  }

  function reset() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    setSpeaking(false); setResult(null); setMessage(''); clearImage(); setError(''); setDraftOpen(false)
  }
  function copyDraft() {
    if (!result?.auto_draft) return
    navigator.clipboard.writeText(result.auto_draft).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }
  function downloadCalendar() {
    if (!result?.deadline_iso) return
    try {
      const dt = new Date(result.deadline_iso)
      const dtStr = dt.toISOString().replace(/[-:]/g, '').replace('.000', '')
      const ics = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Deadline Rescue AI//EN', 'BEGIN:VEVENT',
        `DTSTART:${dtStr}`, `SUMMARY:\u23f0 ${result.task_name}`,
        `DESCRIPTION:${result.consequence.replace(/\n/g, '\\n')}\\n\\nAction: ${result.action_plan.now.replace(/\n/g, '\\n')}`,
        `UID:dr-${Date.now()}@deadline-rescue`, 'STATUS:NEEDS-ACTION', 'END:VEVENT', 'END:VCALENDAR',
      ].join('\r\n')
      const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
      const a = Object.assign(document.createElement('a'), { href: url, download: `${result.task_name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.ics` })
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
  }
  function shareResult() {
    if (!result) return
    const text = [
      `\u23f0 Deadline Rescue AI`, '', `Task: ${result.task_name}`, `Due: ${result.deadline_text}`,
      `Time Left: ${result.time_remaining}`, `Urgency: ${result.urgency_level}`, '',
      `What to do now: ${result.action_plan.now}`, '', `Check your deadlines free: ${window.location.origin}`,
    ].join('\n')
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }
  function sendDraftOnWhatsApp() {
    if (!result?.auto_draft) return
    window.open(`https://wa.me/?text=${encodeURIComponent(result.auto_draft)}`, '_blank')
  }
  function speakResult() {
    if (!result) return
    if (!('speechSynthesis' in window)) { setError("Read-aloud isn\u2019t supported in this browser."); return }
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return }
    const isHindi = result.language === 'hi' || result.language === 'hinglish'
    const utterance = new SpeechSynthesisUtterance(
      [URGENCY_CONFIG[result.urgency_level].label + ' urgency.', result.task_name, `Due ${result.deadline_text}.`, `${result.time_remaining} remaining.`, result.action_plan.now].join('. ')
    )
    utterance.lang = isHindi ? 'hi-IN' : 'en-IN'
    utterance.rate = 0.95
    utterance.onend = utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
    setSpeaking(true)
  }

  const canAnalyze = (inputMode === 'paste' && message.trim().length >= 10) || (inputMode === 'image' && !!imageFile)
  const uc = result ? URGENCY_CONFIG[result.urgency_level] : null

  return (
    <main className="min-h-screen py-8 px-4" style={{ background: 'var(--bg)' }}>
      <style>{`
        @keyframes pulse-glow { 0%, 100% { box-shadow: 0 0 12px rgba(124,111,255,0.4); } 50% { box-shadow: 0 0 28px rgba(124,111,255,0.8), 0 0 48px rgba(124,111,255,0.3); } }
        @keyframes mic-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,68,102,0.5); } 50% { box-shadow: 0 0 0 12px rgba(255,68,102,0); } }
        @keyframes badge-shine { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        @keyframes countdown-tick { 0% { opacity: 1; } 50% { opacity: 0.7; } 100% { opacity: 1; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .gemini-badge { background: linear-gradient(90deg, #4285f4, #7c6fff, #ea4335, #7c6fff, #4285f4); background-size: 200% auto; animation: badge-shine 3s linear infinite; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .countdown-live { animation: countdown-tick 1s ease-in-out infinite; }
        .voice-listening { animation: mic-pulse 1s ease-in-out infinite; }
      `}</style>

      <div className="max-w-xl mx-auto flex flex-col gap-5">

        <nav className="flex items-center justify-between">
          <span className="text-xs font-mono uppercase tracking-widest" style={{ color: 'var(--text3)' }}>Vibe2Ship · PS1</span>
          <a href="/dashboard" className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)' }}>
            📊 Dashboard →
          </a>
        </nav>

        <div className="text-center pb-1">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4 text-xs font-semibold tracking-widest uppercase"
               style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-glow)', color: 'var(--accent)' }}>
            ✦ Powered by <span className="gemini-badge font-bold">Gemini 2.5 Flash</span>
          </div>
          <h1 className="text-4xl font-bold mb-3" style={{ color: 'var(--text)', letterSpacing: '-0.02em' }}>⏰ Deadline Rescue AI</h1>
          <p className="text-lg font-semibold mb-1" style={{ color: 'var(--text)' }}>Paste any message. Know exactly what to do.</p>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>AI extracts your deadline, scores urgency, and hands you a step-by-step action plan — instantly.</p>
        </div>

        {!result && (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex" style={{ borderBottom: '1px solid var(--border)' }}>
              {(['paste', 'image'] as InputMode[]).map(mode => (
                <button key={mode} onClick={() => { setInputMode(mode); setError('') }}
                  className="flex-1 py-3 text-xs font-semibold transition-all"
                  style={{
                    background: inputMode === mode ? 'var(--surface2)' : 'transparent',
                    color: inputMode === mode ? 'var(--accent)' : 'var(--text3)',
                    borderBottom: inputMode === mode ? '2px solid var(--accent)' : '2px solid transparent',
                  }}>
                  {mode === 'paste' ? '✏ Paste Message' : '📷 Screenshot / Photo'}
                </button>
              ))}
            </div>

            {inputMode === 'paste' && (
              <div className="p-4 flex flex-col gap-3">
                <button onClick={toggleVoice}
                  className={`w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${listening ? 'voice-listening' : ''}`}
                  style={{
                    background: listening ? 'rgba(255,68,102,0.15)' : 'var(--accent-dim)',
                    border: listening ? '1.5px solid rgba(255,68,102,0.5)' : '1.5px solid var(--accent-glow)',
                    color: listening ? '#ff4466' : 'var(--accent)',
                    animation: listening ? 'mic-pulse 1s ease-in-out infinite' : 'pulse-glow 2.5s ease-in-out infinite',
                  }}>
                  <span className="text-lg">{listening ? '🔴' : '🎙'}</span>
                  {listening ? 'Listening… tap to stop' : '🎙 Speak your deadline'}
                </button>

                <div className="flex items-center gap-2" style={{ color: 'var(--text3)' }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span className="text-xs">or type below</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>

                <textarea
                  value={message}
                  onChange={e => { setMessage(e.target.value); setError('') }}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) analyzeDeadline() }}
                  placeholder="Paste any SMS, WhatsApp, email, or notification that contains a deadline..."
                  rows={4}
                  className="w-full text-sm leading-relaxed rounded-xl px-4 py-3"
                  style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', caretColor: 'var(--accent)' }}
                />

                <div>
                  <p className="text-xs mb-2" style={{ color: 'var(--text3)' }}>Try a sample:</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(SAMPLES).map(k => (
                      <button key={k} onClick={() => { setMessage(SAMPLES[k]); setError('') }}
                        className="text-xs px-3 py-1.5 rounded-full transition-all"
                        style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)' }}>
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {inputMode === 'image' && (
              <div className="p-4 flex flex-col gap-3">
                <span className="block font-mono text-xs uppercase tracking-widest" style={{ color: 'var(--text3)' }}>
                  Upload screenshot or take a photo of the message
                </span>
                {!imagePreview ? (
                  <div onDrop={handleDrop} onDragOver={e => { e.preventDefault(); setIsDragging(true) }} onDragLeave={() => setIsDragging(false)}
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-xl flex flex-col items-center justify-center gap-2 py-10 cursor-pointer transition-all"
                    style={{ border: `2px dashed ${isDragging ? 'var(--accent)' : 'var(--border)'}`, background: isDragging ? 'var(--accent-dim)' : 'var(--surface2)' }}>
                    <span className="text-3xl">📋</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--text2)' }}>Drop image here or click to browse</span>
                    <span className="text-xs" style={{ color: 'var(--text3)' }}>PNG, JPG, WEBP — screenshots, photos, forwards</span>
                  </div>
                ) : (
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                    <div className="relative">
                      <img src={imagePreview} alt="Preview" className="w-full max-h-52 object-contain" style={{ background: 'var(--surface2)' }} />
                      <button onClick={clearImage} className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: 'rgba(0,0,0,.7)', color: 'white', border: '1px solid rgba(255,255,255,.2)' }}>✕</button>
                    </div>
                    <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: 'var(--surface2)', borderTop: '1px solid var(--border)' }}>
                      <span className="text-xs" style={{ color: 'var(--accent)' }}>✓</span>
                      <span className="text-xs font-mono" style={{ color: 'var(--text2)' }}>{imageFile?.name ?? 'image'} ready to analyze</span>
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => fileInputRef.current?.click()} className="flex-1 py-2.5 rounded-xl text-xs font-semibold"
                    style={{ border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)' }}>📁 Browse Files</button>
                  <button onClick={() => cameraInputRef.current?.click()} className="flex-1 py-2.5 rounded-xl text-xs font-semibold"
                    style={{ border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)' }}>📷 Take Photo</button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f) }} />
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f) }} />
              </div>
            )}

            {error && (
              <div className="mx-4 mb-3 px-4 py-3 rounded-xl text-xs" style={{ background: 'rgba(255,68,102,.08)', border: '1px solid rgba(255,68,102,.2)', color: '#ff8899' }}>
                {error}
              </div>
            )}

            <div className="px-4 pb-4">
              <button onClick={analyzeDeadline} disabled={!canAnalyze || loading} className="w-full py-4 rounded-xl text-sm font-bold transition-all"
                style={{
                  background: canAnalyze && !loading ? 'var(--accent)' : 'var(--surface2)',
                  color: canAnalyze && !loading ? 'white' : 'var(--text3)',
                  opacity: loading ? 0.9 : 1,
                  cursor: !canAnalyze || loading ? 'not-allowed' : 'pointer',
                  boxShadow: canAnalyze && !loading ? '0 0 24px var(--accent-glow)' : 'none',
                }}>
                {loading ? (
                  <span className="flex items-center justify-center gap-3">
                    <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    <span>{LOADING_STEPS[loadingStep]}</span>
                  </span>
                ) : '⚡ Extract Deadline →'}
              </button>
            </div>
          </div>
        )}

        {result && uc && (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: `1.5px solid ${uc.border}` }}>
            <div className="px-5 pt-4 pb-3 flex items-center justify-between flex-wrap gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)' }}>
                  {CATEGORY_ICON[result.category]} {result.category}
                </span>
                {result.confidence < 60 && (
                  <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: 'rgba(255,209,102,.1)', border: '1px solid rgba(255,209,102,.2)', color: '#ffd166' }}>
                    ⚠ Low confidence
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: 'rgba(66,133,244,0.1)', border: '1px solid rgba(66,133,244,0.25)' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L9.5 9.5L2 12L9.5 14.5L12 22L14.5 14.5L22 12L14.5 9.5L12 2Z" fill="url(#g)" />
                  <defs><linearGradient id="g" x1="2" y1="2" x2="22" y2="22"><stop stopColor="#4285F4"/><stop offset="1" stopColor="#7c6fff"/></linearGradient></defs>
                </svg>
                <span className="gemini-badge">{provider === 'groq' ? 'Analyzed by Groq' : 'Analyzed by Gemini 2.5 Flash'}</span>
              </div>
            </div>

            <div className="px-5 py-5 flex flex-col gap-5">
              <div>
                <p className="text-xl font-bold leading-snug" style={{ color: 'var(--text)' }}>{result.task_name}</p>
                <p className="text-sm mt-1" style={{ color: 'var(--text2)' }}>📅 {result.deadline_text}</p>
              </div>

              {result.deadline_iso && countdown && (
                <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: uc.bg, border: `1.5px solid ${uc.border}` }}>
                  <div>
                    <p className="text-xs font-mono uppercase tracking-widest mb-1" style={{ color: uc.color, opacity: 0.7 }}>⏱ Live countdown</p>
                    <p className="text-2xl font-bold tabular-nums countdown-live" style={{ color: uc.color }}>{countdown}</p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{uc.icon}</span>
                      <span className="text-base font-bold" style={{ color: uc.color }}>{uc.label}</span>
                    </div>
                    <span className="text-xs font-mono px-2.5 py-1 rounded-full" style={{ background: uc.bg, border: `1px solid ${uc.border}`, color: uc.color }}>
                      {result.urgency_score}/100
                    </span>
                  </div>
                </div>
              )}

              <div className="h-1.5 rounded-full overflow-hidden -mt-3" style={{ background: 'rgba(255,255,255,.06)' }}>
                <div style={{ width: `${result.urgency_score}%`, height: '100%', borderRadius: '999px', background: `linear-gradient(90deg, ${uc.color}66, ${uc.color})`, transition: 'width 1.2s ease' }} />
              </div>

              <div className="rounded-xl p-4" style={{ background: 'rgba(255,68,102,.05)', border: '1px solid rgba(255,68,102,.15)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-base">⚠️</span>
                  <p className="font-mono text-xs uppercase tracking-widest font-bold" style={{ color: '#ff4466' }}>If you miss this</p>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text2)' }}>{result.consequence}</p>
              </div>

              <div>
                <p className="font-mono text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--text3)' }}>Your 3-step action plan</p>
                <div className="flex flex-col gap-2.5">
                  <div className="p-3.5 rounded-xl flex gap-3 items-start" style={{ background: 'rgba(6,214,160,.07)', border: '1px solid rgba(6,214,160,.2)' }}>
                    <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'rgba(6,214,160,.2)', color: '#06d6a0', border: '1px solid rgba(6,214,160,.3)' }}>1</div>
                    <div>
                      <p className="text-xs font-bold mb-1" style={{ color: '#06d6a0' }}>⚡ Do right now</p>
                      <p className="text-sm leading-relaxed" style={{ color: 'var(--text2)' }}>{result.action_plan.now}</p>
                    </div>
                  </div>
                  <div className="p-3.5 rounded-xl flex gap-3 items-start" style={{ background: 'rgba(255,209,102,.06)', border: '1px solid rgba(255,209,102,.2)' }}>
                    <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'rgba(255,209,102,.2)', color: '#ffd166', border: '1px solid rgba(255,209,102,.3)' }}>2</div>
                    <div>
                      <p className="text-xs font-bold mb-1" style={{ color: '#ffd166' }}>📋 Before it&rsquo;s too late</p>
                      <p className="text-sm leading-relaxed" style={{ color: 'var(--text2)' }}>{result.action_plan.soon}</p>
                    </div>
                  </div>
                  <div className="p-3.5 rounded-xl flex gap-3 items-start" style={{ background: 'rgba(255,68,102,.06)', border: '1px solid rgba(255,68,102,.18)' }}>
                    <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'rgba(255,68,102,.2)', color: '#ff4466', border: '1px solid rgba(255,68,102,.3)' }}>3</div>
                    <div>
                      <p className="text-xs font-bold mb-1" style={{ color: '#ff4466' }}>🆘 Last resort</p>
                      <p className="text-sm leading-relaxed" style={{ color: 'var(--text2)' }}>{result.action_plan.emergency}</p>
                    </div>
                  </div>
                </div>
              </div>

              <SubtaskBreakdown result={result} prefetchedSubtasks={autoSubtasks} />
              <LeaveByMap deadlineIso={result.deadline_iso} taskName={result.task_name} autoSuggestTravel={result.category === 'Interview' || result.category === 'Meeting'} />

              {result.auto_draft && result.auto_draft_type !== 'none' && (
                <div>
                  <button onClick={() => setDraftOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-semibold transition-all"
                    style={{ background: draftOpen ? 'var(--accent-dim)' : 'var(--surface2)', border: '1px solid var(--border)', color: draftOpen ? 'var(--accent)' : 'var(--text2)' }}>
                    <div className="flex items-center gap-2">
                      <span>✉️</span>
                      <span>Ready-to-send {DRAFT_LABEL[result.auto_draft_type] ?? 'message'}</span>
                    </div>
                    <span style={{ transform: draftOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
                  </button>
                  {draftOpen && (
                    <div className="rounded-xl overflow-hidden mt-2" style={{ border: '1px solid var(--border)' }}>
                      <pre className="text-xs leading-relaxed p-4 overflow-x-auto whitespace-pre-wrap" style={{ background: 'var(--surface2)', color: 'var(--text2)', fontFamily: 'inherit' }}>
                        {result.auto_draft}
                      </pre>
                      <div className="flex gap-2 px-3 py-2.5" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
                        <button onClick={copyDraft} className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                          style={{ border: '1px solid var(--border)', background: copied ? 'rgba(6,214,160,.12)' : 'transparent', color: copied ? '#06d6a0' : 'var(--text2)' }}>
                          {copied ? '✓ Copied!' : '📋 Copy text'}
                        </button>
                        <button onClick={sendDraftOnWhatsApp} className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                          style={{ border: '1px solid rgba(37,211,102,.3)', background: 'transparent', color: '#25d366' }}>
                          📤 Send via WhatsApp
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-5 pb-5 flex flex-col gap-2.5" style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
              <div className="flex gap-2.5">
                <button onClick={reset} className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all"
                  style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)' }}>← Check another</button>
                <button onClick={speakResult} className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
                  style={speaking ? { border: '1px solid var(--accent-glow)', background: 'var(--accent-dim)', color: 'var(--accent)' } : { border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)' }}>
                  {speaking ? '◼ Stop' : '🔊 Read aloud'}
                </button>
                {result.deadline_iso && (
                  <button onClick={downloadCalendar} className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all"
                    style={{ border: '1px solid rgba(124,111,255,.3)', background: 'transparent', color: 'var(--accent)' }}>📅 Calendar</button>
                )}
              </div>
              <SaveToDashboard result={result} />
              <button onClick={shareResult} className="w-full py-2.5 rounded-xl text-xs font-semibold transition-all"
                style={{ border: '1px solid rgba(37,211,102,.3)', background: 'transparent', color: '#25d366' }}>
                Share on WhatsApp →
              </button>
            </div>
          </div>
        )}

        {error && !result && !loading && (
          <div className="px-4 py-3.5 rounded-xl text-sm" style={{ background: 'rgba(255,68,102,.08)', border: '1px solid rgba(255,68,102,.2)', color: '#ff8899' }}>{error}</div>
        )}

        {!result && (
          <div className="grid grid-cols-2 gap-3">
            <InfoCard title="Supported messages">
              {['Assignment submission emails', 'Bill & subscription reminders', 'Interview & meeting confirmations', 'Exam registration notices', 'Job application deadlines', 'WhatsApp group deadlines']}
            </InfoCard>
            <InfoCard title="What you get">
              {['Live countdown timer', 'Urgency score (0–100)', 'Leave-by travel calculator', 'Smart subtask breakdown', 'Auto-draft message', 'Mission control dashboard']}
            </InfoCard>
          </div>
        )}

        <div className="text-center text-xs pb-4 flex flex-col gap-1.5" style={{ color: 'var(--text3)' }}>
          <div className="flex items-center justify-center gap-2">
            <span className="gemini-badge text-xs font-semibold">✦ Powered by Gemini 2.5 Flash</span>
            <span>·</span><span>Google Technologies</span>
          </div>
          <span>Deadline Rescue AI · Built for Vibe2Ship Hackathon</span>
        </div>
      </div>
    </main>
  )
}

function InfoCard({ title, children }: { title: string; children: string[] }) {
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <p className="font-mono text-xs uppercase tracking-widest" style={{ color: 'var(--text3)' }}>{title}</p>
      <ul className="flex flex-col gap-1">
        {children.map(item => (
          <li key={item} className="text-xs flex items-start gap-1.5" style={{ color: 'var(--text2)' }}>
            <span style={{ color: 'var(--accent)', marginTop: '0.1rem' }}>›</span>{item}
          </li>
        ))}
      </ul>
    </div>
  )
}
