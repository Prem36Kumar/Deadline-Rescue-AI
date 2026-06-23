'use client'
import { useEffect, useRef, useState } from 'react'

interface VoiceButtonProps {
  onResult: (text: string) => void
  lang?: string
}

export default function VoiceButton({ onResult, lang = 'en-IN' }: VoiceButtonProps) {
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(true)
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setSupported(false)
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = lang
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (e: any) => {
      const text = e.results[0][0].transcript
      onResult(text)
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)
    recognitionRef.current = recognition
    return () => recognition.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  function toggle() {
    if (!supported || !recognitionRef.current) return
    if (listening) {
      recognitionRef.current.stop()
      setListening(false)
    } else {
      recognitionRef.current.start()
      setListening(true)
    }
  }

  if (!supported) return null

  return (
    <button
      type="button"
      onClick={toggle}
      title={listening ? 'Stop recording' : 'Speak your deadline'}
      className="flex items-center justify-center w-10 h-10 rounded-full shrink-0 transition-all"
      style={{
        background: listening ? 'rgba(255,68,102,.15)' : 'var(--surface2)',
        border: `1px solid ${listening ? 'rgba(255,68,102,.4)' : 'var(--border)'}`,
        color: listening ? '#ff4466' : 'var(--text2)',
      }}
    >
      <span className="text-base">{listening ? '◼' : '🎤'}</span>
    </button>
  )
}
