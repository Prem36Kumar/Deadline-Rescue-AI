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

// ── Gemini function-calling agent loop ───────────────────────────────────────
const TOOLS = [{
  functionDeclarations: [
    {
      name: 'save_deadline_result',
      description: 'Save the fully analyzed deadline result after reasoning through all fields',
      parameters: {
        type: 'OBJECT',
        properties: {
          task_name:       { type: 'STRING',  description: 'Short task name' },
          deadline_text:   { type: 'STRING',  description: 'Human readable deadline' },
          deadline_iso:    { type: 'STRING',  description: 'ISO 8601 datetime or empty string' },
          time_remaining:  { type: 'STRING',  description: 'e.g. 2 days 4 hours or OVERDUE' },
          urgency_score:   { type: 'NUMBER',  description: '0-100' },
          urgency_level:   { type: 'STRING',  enum: ['Critical','High','Medium','Low'] },
          category:        { type: 'STRING',  enum: ['Assignment','Bill Payment','Interview','Meeting','Exam','Job Application','Subscription','Other'] },
          consequence:     { type: 'STRING' },
          action_plan_now: { type: 'STRING' },
          action_plan_soon:{ type: 'STRING' },
          action_plan_emergency: { type: 'STRING' },
          auto_draft:      { type: 'STRING' },
          auto_draft_type: { type: 'STRING',  enum: ['extension_request','confirmation','payment_reminder','apology','none'] },
          language:        { type: 'STRING',  enum: ['en','hi','hinglish'] },
          confidence:      { type: 'NUMBER',  description: '0-100' },
        },
        required: ['task_name','deadline_text','time_remaining','urgency_score','urgency_level','category','consequence','action_plan_now','action_plan_soon','action_plan_emergency','language','confidence'],
      },
    },
  ],
}]

async function runGeminiAgent(contents: any[], apiKey: string): Promise<any> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, tools: TOOLS, systemInstruction: { parts: [{ text: getSystemPrompt() }] }, generationConfig: { temperature: 0.1, maxOutputTokens: 1200 } }),
    }
  )
  return res.json()
}

async function callGeminiWithFunctionCalling(contents: any[], apiKey: string): Promise<any> {
  let json = await runGeminiAgent(contents, apiKey)

  // Retry once on 503
  if (json?.error?.code === 503) {
    await new Promise(r => setTimeout(r, 2500))
    json = await runGeminiAgent(contents, apiKey)
  }
  if (json?.error) throw Object.assign(new Error(json.error.message), { status: json.error.code ?? 500 })

  const candidate = json?.candidates?.[0]
  const parts = candidate?.content?.parts ?? []

  // Check if model used function call (agentic)
  const fnCall = parts.find((p: any) => p.functionCall)
  if (fnCall) {
    const args = fnCall.functionCall.args
    return {
      task_name: args.task_name, deadline_text: args.deadline_text,
      deadline_iso: args.deadline_iso || null, time_remaining: args.time_remaining,
      urgency_score: args.urgency_score, urgency_level: args.urgency_level,
      category: args.category, consequence: args.consequence,
      action_plan: { now: args.action_plan_now, soon: args.action_plan_soon, emergency: args.action_plan_emergency },
      auto_draft: args.auto_draft ?? '', auto_draft_type: args.auto_draft_type ?? 'none',
      language: args.language, confidence: args.confidence,
    }
  }

  // Fallback: parse text response
  const text = parts.find((p: any) => p.text)?.text ?? ''
  if (!text) throw new Error('Empty Gemini response')
  return JSON.parse(extractJson(text))
}

async function callGroqFallback(body: any): Promise<{ data: any; provider: string }> {
  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey) throw new Error('No Groq key')
  const isImage = 'image' in body
  const messages = isImage
    ? [{ role: 'user', content: [{ type: 'text', text: getSystemPrompt() + '\n\nExtract deadline from this image.' }, { type: 'image_url', image_url: { url: `data:${body.mediaType};base64,${body.image}` } }] }]
    : [{ role: 'system', content: getSystemPrompt() }, { role: 'user', content: `Extract deadline:\n\n${body.message}` }]
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 900, temperature: 0.1, messages }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message ?? 'Groq failed')
  const raw = json.choices[0]?.message?.content ?? ''
  return { data: JSON.parse(extractJson(raw)), provider: 'groq' }
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
  if (!imageParsed.success && !textParsed.success) return Response.json({ success: false, message: 'Paste a message or upload a screenshot.' }, { status: 400 })

  const geminiKey = process.env.GEMINI_API_KEY

  try {
    let rawData: any, provider = 'gemini'

    try {
      if (!geminiKey) throw new Error('No Gemini key')
      const contents = imageParsed.success
        ? [{ role: 'user', parts: [{ text: 'Extract every deadline detail from this screenshot.' }, { inlineData: { mimeType: imageParsed.data.mediaType, data: imageParsed.data.image } }] }]
        : [{ role: 'user', parts: [{ text: `Extract the deadline from this message:\n\n${textParsed.data!.message}` }] }]
      rawData = await callGeminiWithFunctionCalling(contents, geminiKey)
    } catch (err: any) {
      console.warn('[extract] Gemini failed, trying Groq:', err?.message)
      const fb = await callGroqFallback(body)
      rawData = fb.data; provider = fb.provider
    }

    // Normalize action_plan if it came flat from function calling
    if (rawData.action_plan_now && !rawData.action_plan) {
      rawData.action_plan = { now: rawData.action_plan_now, soon: rawData.action_plan_soon, emergency: rawData.action_plan_emergency }
    }

    const data = DeadlineResultSchema.parse(rawData)
    return Response.json({ success: true, data, provider })
  } catch (err: any) {
    console.error('[extract]', err)
    return Response.json({ success: false, message: 'Could not analyze. Please try again.' }, { status: 500 })
  }
}
