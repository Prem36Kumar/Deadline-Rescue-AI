import { NextRequest, NextResponse } from 'next/server'
import { getSystemPrompt } from '@/lib/prompt'
import { z } from 'zod'

const TextSchema  = z.object({ message: z.string().min(10).max(3000) })
const ImageSchema = z.object({ image: z.string().min(10), mediaType: z.string().min(3) })

const TOOLS = [{
  functionDeclarations: [
    {
      name: 'save_deadline_result',
      description: 'Extract and save all deadline information from the message. Call this first.',
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
          needs_travel:          { type: 'BOOLEAN' },
        },
        required: ['task_name','deadline_text','time_remaining','urgency_score','urgency_level','category','consequence','action_plan_now','action_plan_soon','action_plan_emergency','language','confidence','needs_travel'],
      },
    },
    {
      name: 'generate_subtasks',
      description: 'After saving deadline result, generate step-by-step subtasks. Always call after save_deadline_result.',
      parameters: {
        type: 'OBJECT',
        properties: {
          subtasks: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                step:                  { type: 'STRING' },
                detail:                { type: 'STRING' },
                time_estimate_minutes: { type: 'NUMBER' },
              },
              required: ['step','detail','time_estimate_minutes'],
            },
          },
        },
        required: ['subtasks'],
      },
    },
  ],
}]

async function runAgentLoop(initialContents: any[], apiKey: string) {
  const contents = [...initialContents]
  let deadlineResult: any = null
  let subtasks: any[] = []
  let iterations = 0

  while (iterations < 6) {
    iterations++
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents, tools: TOOLS,
          systemInstruction: { parts: [{ text: getSystemPrompt() + '\n\nYou are an autonomous deadline agent. ALWAYS call save_deadline_result first, then ALWAYS call generate_subtasks. Both must be called.' }] },
          generationConfig: { temperature: 0.1, maxOutputTokens: 1500 },
        }),
      }
    )
    const json = await res.json()
    if (json?.error?.code === 503) { await new Promise(r => setTimeout(r, 2500)); continue }
    if (json?.error) throw new Error(json.error.message ?? 'Gemini error')

    const parts: any[] = json?.candidates?.[0]?.content?.parts ?? []
    const finishReason = json?.candidates?.[0]?.finishReason
    contents.push({ role: 'model', parts })

    const toolResults: any[] = []
    let calledAnyTool = false

    for (const part of parts) {
      if (!part.functionCall) continue
      calledAnyTool = true
      const { name, args } = part.functionCall
      if (name === 'save_deadline_result') {
        deadlineResult = args
        toolResults.push({ functionResponse: { name, response: { success: true, message: 'Saved. Now call generate_subtasks.' } } })
      }
      if (name === 'generate_subtasks') {
        subtasks = args.subtasks ?? []
        toolResults.push({ functionResponse: { name, response: { success: true, message: 'Done.' } } })
      }
    }

    if (toolResults.length > 0) contents.push({ role: 'user', parts: toolResults })
    if (deadlineResult && subtasks.length > 0) break
    if (!calledAnyTool && finishReason === 'STOP') break
  }
  return { deadlineResult, subtasks }
}

async function groqFallback(body: any) {
  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey) throw new Error('No Groq key')
  const isImage = 'image' in body
  const extractMessages = isImage
    ? [{ role: 'user', content: [
        { type: 'text', text: getSystemPrompt() + '\n\nRespond ONLY with valid JSON.' },
        { type: 'image_url', image_url: { url: `data:${body.mediaType};base64,${body.image}` } },
      ]}]
    : [
        { role: 'system', content: getSystemPrompt() + '\n\nRespond ONLY with valid JSON.' },
        { role: 'user', content: `Extract deadline from:\n\n${body.message}` },
      ]
  const extractRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: isImage ? 'meta-llama/llama-4-scout-17b-16e-instruct' : 'llama-3.3-70b-versatile', max_tokens: 900, temperature: 0.1, messages: extractMessages }),
  })
  const extractJson = await extractRes.json()
  const rawExtract = extractJson.choices?.[0]?.message?.content ?? ''
  const clean = rawExtract.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim()
  const deadlineResult = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}')+1))

  const subtaskRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile', max_tokens: 700, temperature: 0.2,
      messages: [
        { role: 'system', content: 'Task planner for India. Respond ONLY with valid JSON: {"subtasks":[{"step":"...","detail":"...","time_estimate_minutes":N}]}' },
        { role: 'user', content: `Break into 3-6 steps:\nTask: ${deadlineResult.task_name}\nCategory: ${deadlineResult.category}\nDeadline: ${deadlineResult.deadline_text}` },
      ],
    }),
  })
  const subtaskJson = await subtaskRes.json()
  const rawSub = subtaskJson.choices?.[0]?.message?.content ?? ''
  const cleanSub = rawSub.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim()
  const subtasks = JSON.parse(cleanSub.slice(cleanSub.indexOf('{'), cleanSub.lastIndexOf('}')+1)).subtasks ?? []
  return { deadlineResult, subtasks }
}

async function checkRateLimit(ip: string) {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return { allowed: true }
  try {
    const { Ratelimit } = await import('@upstash/ratelimit')
    const { Redis } = await import('@upstash/redis')
    const rl = new Ratelimit({ redis: new Redis({ url, token }), limiter: Ratelimit.slidingWindow(10, '1 m'), analytics: false })
    const { success, reset } = await rl.limit(ip)
    return { allowed: success, retryAfter: success ? undefined : Math.ceil((reset - Date.now()) / 1000) }
  } catch { return { allowed: true } }
}

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'anonymous').split(',')[0].trim()
  const { allowed, retryAfter } = await checkRateLimit(ip)
  if (!allowed) return NextResponse.json({ success: false, message: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(retryAfter ?? 60) } })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ success: false, message: 'Invalid request.' }, { status: 400 }) }

  const imageParsed = ImageSchema.safeParse(body)
  const textParsed  = TextSchema.safeParse(body)
  if (!imageParsed.success && !textParsed.success) return NextResponse.json({ success: false, message: 'Paste a message or upload a screenshot.' }, { status: 400 })

  try {
    let deadlineResult: any, subtasks: any[], provider = 'gemini'
    try {
      if (!process.env.GEMINI_API_KEY) throw new Error('No Gemini key')
      const initialContents = imageParsed.success
        ? [{ role: 'user', parts: [{ text: 'Extract deadline from this screenshot and generate a plan.' }, { inlineData: { mimeType: imageParsed.data.mediaType, data: imageParsed.data.image } }] }]
        : [{ role: 'user', parts: [{ text: `Extract deadline and generate a plan:\n\n${textParsed.data!.message}` }] }]
      const result = await runAgentLoop(initialContents, process.env.GEMINI_API_KEY)
      if (!result.deadlineResult) throw new Error('Agent did not extract deadline')
      deadlineResult = result.deadlineResult
      subtasks = result.subtasks
    } catch (err: any) {
      console.warn('[agent] Gemini failed, Groq fallback:', err?.message)
      const fb = await groqFallback(body)
      deadlineResult = fb.deadlineResult; subtasks = fb.subtasks; provider = 'groq'
    }

    const data = {
      ...deadlineResult,
      deadline_iso: deadlineResult.deadline_iso || null,
      action_plan: {
        now:       deadlineResult.action_plan_now       ?? deadlineResult.action_plan?.now       ?? '',
        soon:      deadlineResult.action_plan_soon      ?? deadlineResult.action_plan?.soon      ?? '',
        emergency: deadlineResult.action_plan_emergency ?? deadlineResult.action_plan?.emergency ?? '',
      },
      auto_draft:      deadlineResult.auto_draft      ?? '',
      auto_draft_type: deadlineResult.auto_draft_type ?? 'none',
    }
    return NextResponse.json({ success: true, data, subtasks, provider, agentic: provider === 'gemini' })
  } catch (err: any) {
    console.error('[agent]', err)
    return NextResponse.json({ success: false, message: 'Could not analyze. Please try again.' }, { status: 500 })
  }
}
