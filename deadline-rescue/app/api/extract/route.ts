import { GoogleGenAI } from '@google/genai'
import Groq from 'groq-sdk'
import { NextRequest } from 'next/server'
import { DeadlineResultSchema } from '@/lib/schema'
import { getSystemPrompt } from '@/lib/prompt'
import { z } from 'zod'

function getGemini() { return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' }) }
function getGroq()   { return new Groq({ apiKey: process.env.GROQ_API_KEY ?? '' }) }

const GEMINI_MODEL = 'gemini-2.5-flash'
const GROQ_MODEL = 'llama-3.3-70b-versatile' // text only
const GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct' // image+text

const TextSchema  = z.object({ message: z.string().min(10).max(3000) })
const ImageSchema = z.object({ image: z.string().min(10), mediaType: z.string().min(3) })

function extractJson(raw: string): string {
  let c = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/g, '').trim()
  const s = c.indexOf('{'), e = c.lastIndexOf('}')
  if (s === -1 || e === -1) return c
  c = c.slice(s, e + 1)
  c = c.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')
  return c
}

function isQuotaError(err: any): boolean {
  const msg = err?.message ?? ''
  return err?.status === 429 || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('rate_limit')
}

async function callGeminiText(message: string): Promise<string> {
  const r = await getGemini().models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: `Extract the deadline from this message:\n\n${message}` }] }],
    config: { systemInstruction: getSystemPrompt(), temperature: 0.1, maxOutputTokens: 900, responseMimeType: 'application/json' },
  })
  return r.text ?? ''
}

async function callGeminiImage(image: string, mediaType: string): Promise<string> {
  const r = await getGemini().models.generateContent({
    model: GEMINI_MODEL,
    contents: [{
      role: 'user',
      parts: [
        { text: 'Read all text in this screenshot and extract every deadline-related detail as instructed.' },
        { inlineData: { mimeType: mediaType, data: image } },
      ],
    }],
    config: { systemInstruction: getSystemPrompt(), temperature: 0.1, maxOutputTokens: 900, responseMimeType: 'application/json' },
  })
  return r.text ?? ''
}

async function callGroqText(message: string): Promise<string> {
  const r = await getGroq().chat.completions.create({
    model: GROQ_VISION_MODEL, max_tokens: 800, temperature: 0.1,
    messages: [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user',   content: `Extract the deadline from this message:\n\n${message}` },
    ],
  })
  return r.choices[0]?.message?.content?.trim() ?? ''
}

async function callGroqImage(image: string, mediaType: string): Promise<string> {
  const r = await (getGroq().chat.completions.create as any)({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    max_tokens: 800, temperature: 0.1,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: getSystemPrompt() + '\n\nRead all text in this screenshot and extract every deadline-related detail as instructed.' },
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${image}` } },
      ],
    }],
  })
  return r.choices[0]?.message?.content?.trim() ?? ''
}

async function checkRateLimit(ip: string) {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
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
  if (!allowed) return Response.json({ success: false, message: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(retryAfter ?? 60) } })

  let body: unknown
  try { body = await req.json() } catch { return Response.json({ success: false, message: 'Invalid request.' }, { status: 400 }) }

  const imageParsed = ImageSchema.safeParse(body)
  const textParsed  = TextSchema.safeParse(body)
  if (!imageParsed.success && !textParsed.success) return Response.json({ success: false, message: 'Paste a message or upload a screenshot.' }, { status: 400 })

  const hasGroqKey = !!process.env.GROQ_API_KEY

  try {
    let raw: string
    let provider = 'gemini'

    try {
      raw = imageParsed.success
        ? await callGeminiImage(imageParsed.data.image, imageParsed.data.mediaType)
        : await callGeminiText(textParsed.data!.message)
    } catch (geminiErr) {
      if (hasGroqKey) {
        provider = 'groq'
        raw = imageParsed.success
          ? await callGroqImage(imageParsed.data.image, imageParsed.data.mediaType)
          : await callGroqText(textParsed.data!.message)
      } else { throw geminiErr }
    }

    const parsed = JSON.parse(extractJson(raw))
    // Normalize flat action_plan fields into nested object
    if (!parsed.action_plan && parsed.action_plan_now) {
      parsed.action_plan = {
        now:       parsed.action_plan_now       ?? '',
        soon:      parsed.action_plan_soon      ?? '',
        emergency: parsed.action_plan_emergency ?? '',
      }
    }
    const data = DeadlineResultSchema.parse(parsed)
    return Response.json({ success: true, data, provider })
  } catch (err: any) {
    console.error('[extract]', err)
    if (isQuotaError(err)) return Response.json({ success: false, message: 'AI is busy — wait 30 seconds and retry.' }, { status: 429 })
    return Response.json({ success: false, message: 'Could not analyze. Please try again.' }, { status: 500 })
  }
}
