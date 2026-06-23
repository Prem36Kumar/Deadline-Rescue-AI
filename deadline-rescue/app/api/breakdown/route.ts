import { NextRequest, NextResponse } from 'next/server'

interface Subtask {
  step: string
  detail: string
  time_estimate_minutes: number
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function buildPrompt(task_name: string, category: string, deadline_text: string, consequence: string) {
  return `You are an autonomous task planner. Break the following deadline task into 3-6 concrete, sequential, doable subtasks for someone in India.
Task: ${task_name}
Category: ${category ?? 'Other'}
Deadline: ${deadline_text ?? 'unknown'}
Consequence if missed: ${consequence ?? 'unknown'}

Each subtask needs: a short "step" title, one practical "detail" sentence (mention real apps/portals when relevant, e.g. BESCOM app, LMS portal, UPI), and a realistic "time_estimate_minutes". Order by what to do first. Be specific, not generic.

Respond ONLY with valid JSON matching: {"subtasks":[{"step":"...","detail":"...","time_estimate_minutes":N}]}`
}

async function callGemini(prompt: string, apiKey: string, attempt = 0): Promise<Subtask[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              subtasks: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    step: { type: 'STRING' },
                    detail: { type: 'STRING' },
                    time_estimate_minutes: { type: 'NUMBER' },
                  },
                  required: ['step', 'detail', 'time_estimate_minutes'],
                },
              },
            },
            required: ['subtasks'],
          },
        },
      }),
    }
  )
  const json = await res.json()
  if ((res.status === 503 || json?.error?.code === 503) && attempt === 0) {
    await sleep(2500)
    return callGemini(prompt, apiKey, 1)
  }
  if (!res.ok || json?.error) throw new Error(json?.error?.message ?? `Gemini HTTP ${res.status}`)
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini returned empty response')
  return (JSON.parse(text)).subtasks as Subtask[]
}

async function callGroq(prompt: string, apiKey: string): Promise<Subtask[]> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 700,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are a task planner. Always respond ONLY with valid JSON. No markdown, no explanation.' },
        { role: 'user', content: prompt },
      ],
    }),
  })
  const json = await res.json()
  if (!res.ok || json?.error) throw new Error(json?.error?.message ?? `Groq HTTP ${res.status}`)
  const raw = json?.choices?.[0]?.message?.content?.trim() ?? ''
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const start = clean.indexOf('{'), end = clean.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('Groq returned non-JSON')
  return (JSON.parse(clean.slice(start, end + 1))).subtasks as Subtask[]
}

export async function POST(req: NextRequest) {
  try {
    const { task_name, category, deadline_text, consequence } = await req.json()
    if (!task_name) return NextResponse.json({ success: false, message: 'Missing task_name.' }, { status: 400 })

    const geminiKey = process.env.GEMINI_API_KEY
    const groqKey   = process.env.GROQ_API_KEY

    if (!geminiKey && !groqKey) return NextResponse.json({ success: false, message: 'No AI API key configured on server.' }, { status: 500 })

    const prompt = buildPrompt(task_name, category, deadline_text, consequence)
    let subtasks: Subtask[]
    let provider = 'gemini'

    try {
      if (!geminiKey) throw new Error('No Gemini key')
      subtasks = await callGemini(prompt, geminiKey)
    } catch (err: any) {
      console.warn('[breakdown] Gemini failed, trying Groq:', err?.message)
      if (!groqKey) return NextResponse.json({ success: false, message: 'AI is overloaded right now. Wait 30 seconds and try again.' }, { status: 503 })
      provider = 'groq'
      subtasks = await callGroq(prompt, groqKey)
    }

    if (!Array.isArray(subtasks) || subtasks.length === 0) return NextResponse.json({ success: false, message: 'AI did not return a valid plan. Try again.' }, { status: 502 })

    return NextResponse.json({ success: true, data: { subtasks }, provider })
  } catch (err: any) {
    console.error('[breakdown]', err)
    return NextResponse.json({ success: false, message: 'Could not generate a step-by-step plan. Please try again.' }, { status: 500 })
  }
}
