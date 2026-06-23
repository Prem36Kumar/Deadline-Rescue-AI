import { NextRequest } from 'next/server'
import { DeadlineResultSchema } from '@/lib/schema'
import { getSystemPrompt } from '@/lib/prompt'
import { z } from 'zod'

const TextSchema  = z.object({ message: z.string().min(10).max(3000) })
const ImageSchema = z.object({ image: z.string().min(10), mediaType: z.string().min(3) })

function extractJson(raw: string): string {
  const c = raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim()
  const s = c.indexOf('{'), e = c.lastIndexOf('}')
  return s === -1 || e === -1 ? c : c.slice(s, e + 1)
}

// ── GROQ PRIMARY ──────────────────────────────────────────────────────────────
async function callGroq(body: any): Promise<any> {
  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey) throw new Error('No Groq key')
  const isImage = 'image' in body
  // Use vision model for images, fast model for text
  const model = 'llama-3.3-70b-versatile'
  const messages = isImage
    ? [{ role: 'user', content: [
        { type: 'text', text: getSystemPrompt() + '\n\nExtract deadline from this image. Respond with ONLY valid JSON.' },
        { type: 'image_url', image_url: { url: `data:${body.mediaType};base64,${body.image}` } }
      ]}]
    : [
        { role: 'system', content: getSystemPrompt() },
        { role: 'user', content: `Extract deadline:\n\n${body.message}` }
      ]
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1000, temperature: 0.1, messages }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message ?? 'Groq failed')
  const raw = json.choices[0]?.message?.content ?? ''
  return JSON.parse(extractJson(raw))
}

// ── GEMINI FALLBACK ───────────────────────────────────────────────────────────
const TOOLS = [{
  functionDeclarations: [{
    name: 'save_deadline_result',
    description: 'Save the fully analyzed deadline result',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_name:             { type: 'STRING' },
        deadline_text:         { type: 'STRING' },
        deadline_iso:          { type: 'STRING' },
        time_remaining:        { type: 'STRING' },
        urgency_score:         { type: 'NUMBER' },
        urgency_level:         { type: 'STRING', enum: ['Critical','High','Medium','Low'] },
        category:              { type: 'STRING', enum: ['Assignment','Bill Payment','Interview','Meeting','Exam','Job Application','Subscription','Other'] },
        consequence:           { type: 'STRING' },
        action_plan_now:       { type: 'STRING' },
        action_plan_soon:      { type: 'STRING' },
        action_plan_emergency: { type: 'STRING' },
        auto_draft:            { type: 'STRING' },
        auto_draft_type:       { type: 'STRING', enum: ['extension_request','confirmation','payment_reminder','apology','none'] },
        language:              { type: 'STRING', enum: ['en','hi','hinglish'] },
        confidence:            { type: 'NUMBER' },
      },
      required: ['task_name','deadline_text','time_remaining','urgency_score','urgency_level','category','consequence','action_plan_now','action_plan_soon','action_plan_emergency','language','confidence'],
    },
  }],
}]

async function callGemini(body: any, apiKey: string): Promise<any> {
  const imageParsed = ImageSchema.safeParse(body)
  const textParsed  = TextSchema.safeParse(body)

  const contents = imageParsed.success
    ? [{ role: 'user', parts: [
        { text: 'Extract every deadline detail from this screenshot.' },
        { inlineData: { mimeType: imageParsed.data.mediaType, data: imageParsed.data.image } }
      ]}]
    : [{ role: 'user', parts: [{ text: `Extract the deadline from this message:\n\n${textParsed.data!.message}` }] }]

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        tools: TOOLS,
        systemInstruction: { parts: [{ text: getSystemPrompt() }] },
        generationConfig: { temperature: 0.1, maxOutputTokens: 1200 },
      }),
    }
  )
  let json = await res.json()
  if (json?.error?.code === 503) {
    await new Promise(r => setTimeout(r, 2500))
    json = await (await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents, tools: TOOLS, systemInstruction: { parts: [{ text: getSystemPrompt() }] }, generationConfig: { temperature: 0.1, maxOutputTokens: 1200 } }) }
    )).json()
  }
  if (json?.error) throw new Error(json.error.message)

  const parts = json?.candidates?.[0]?.content?.parts ?? []
  const fnCall = parts.find((p: any) => p.functionCall)
  if (fnCall) {
    const a = fnCall.functionCall.args
    return {
      task_name: a.task_name, deadline_text: a.deadline_text,
      deadline_iso: a.deadline_iso || null, time_remaining: a.time_remaining,
      urgency_score: a.urgency_score, urgency_level: a.urgency_level,
      category: a.category, consequence: a.consequence,
      action_plan: { now: a.action_plan_now, soon: a.action_plan_soon, emergency: a.action_plan_emergency },
      auto_draft: a.auto_draft ?? '', auto_draft_type: a.auto_draft_type ?? 'none',
      language: a.language, confidence: a.confidence,
    }
  }
  const text = parts.find((p: any) => p.text)?.text ?? ''
  if (!text) throw new Error('Empty Gemini response')
  return JSON.parse(extractJson(text))
}

async function checkRateLimit(ip: string) {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return { allowed: true }
  try {
    const { Ratelimit } = await import('@upstash/ratelimit')
    const { Redis }     = await import('@upstash/redis')
    const rl = new Ratelimit({ redis: new Redis({ url, token }), limiter: Ratelimit.slidingWindow(10, '1 m'), analytics: false })
    const { success, reset } = await rl.limit(ip)
    return { allowed: success, retryAfter: success ? undefined : Math.ceil((reset - Date.now()) / 1000) }
  } catch { return { allowed: true } }
}

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'anonymous').split(',')[0].trim()
  const { allowed, retryAfter } = await checkRateLimit(ip)
  if (!allowed) return Response.json({ success: false, message: 'Too many requests. Wait a moment.' }, { status: 429, headers: { 'Retry-After': String(retryAfter ?? 60) } })

  let body: any
  try { body = await req.json() } catch { return Response.json({ success: false, message: 'Invalid request.' }, { status: 400 }) }

  const imageParsed = ImageSchema.safeParse(body)
  const textParsed  = TextSchema.safeParse(body)
  if (!imageParsed.success && !textParsed.success)
    return Response.json({ success: false, message: 'Paste a message or upload a screenshot.' }, { status: 400 })

  try {
    let rawData: any, provider: string

    // ── GROQ FIRST (fast + free) ──
    try {
      rawData  = await callGroq(body)
      provider = 'groq'
      console.log('[extract] Groq succeeded')
    } catch (groqErr: any) {
      // ── GEMINI FALLBACK ──
      console.warn('[extract] Groq failed, trying Gemini:', groqErr?.message)
      const geminiKey = process.env.GEMINI_API_KEY
      if (!geminiKey) throw new Error('Both Groq and Gemini unavailable')
      rawData  = await callGemini(body, geminiKey)
      provider = 'gemini'
      console.log('[extract] Gemini fallback succeeded')
    }

    // Normalize action_plan if flat
    if (rawData.action_plan_now && !rawData.action_plan) {
      rawData.action_plan = {
        now:       rawData.action_plan_now,
        soon:      rawData.action_plan_soon,
        emergency: rawData.action_plan_emergency,
      }
    }

    const data = DeadlineResultSchema.parse(rawData)
    return Response.json({ success: true, data, provider })

  } catch (err: any) {
    console.error('[extract]', err)
    return Response.json({ success: false, message: 'Could not analyze. Please try again.' }, { status: 500 })
  }
}
