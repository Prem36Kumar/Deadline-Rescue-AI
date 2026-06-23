# ⏰ Deadline Rescue AI

**Paste any message with a deadline (SMS, WhatsApp, email, assignment notice) — AI extracts it, scores urgency, and gives you a 3-tier action plan before it's too late. Includes an auto-draft message + one-tap calendar event.**

Built for **Vibe2Ship — Coding Ninjas × Google for Developers Hackathon · PS1: The Last-Minute Life Saver**.

---

## 🚀 What it does

Most people miss deadlines not because they forgot entirely — but because a deadline was buried in a long email or group chat, they didn't process how close it was, and they had no clear "what to do right now." Deadline Rescue AI fixes all three:

1. **Paste any message** or upload a screenshot
2. AI extracts: task, exact deadline, time remaining, urgency score, what happens if missed
3. Generates an **escalating 3-tier action plan**: what to do right now / before it's too late / as a last resort
4. Generates a **ready-to-send message** (extension request, confirmation, reminder) — copy or send to WhatsApp in one tap
5. **Add to Calendar** — downloads a `.ics` file that opens in Google/Apple Calendar with one click
6. **Read aloud** — results spoken in Hindi or English, browser-native, no API

## 🧠 Why this is different from a to-do app

Most teams will build a generic task manager. This is specifically about **rescuing late-deadline situations** — the moment you realize something is due soon and panic. The core AI doesn't just label urgency; it generates context-specific, actionable guidance calibrated to exactly how much time you have left.

This directly addresses the stated PS1 evaluation focus: *"demonstrate how AI can improve productivity by helping users make better decisions and complete tasks more effectively."*

## 🛠️ Tech stack

- **Next.js 14** (App Router) + TypeScript
- **Google Gemini 2.5 Flash** — extracts structured deadline data from any text or screenshot image in one call (no separate OCR step). The system prompt includes live IST timestamp so "time remaining" calculations are always accurate.
- **Groq (`qwen/qwen3.6-27b`)** — automatic fallback if Gemini's free tier rate-limits during judging. Vision-capable.
- **Web Speech API** — browser-native read-aloud, Hindi/English, zero API cost
- **ICS calendar download** — generates a standard `.ics` file from the extracted deadline ISO timestamp; opens in Google Calendar, Apple Calendar, Outlook
- **Zod** for strict AI response validation

## ⚙️ Setup

```bash
npm install
cp .env.local.example .env.local
# Add your free Gemini key from https://aistudio.google.com/app/apikey
# (Optional) Add a free Groq key from https://console.groq.com/keys
npm run dev
```

## 📦 Deploy to Vercel

1. Push to GitHub
2. Import repo on Vercel — **set Root Directory to `deadline-rescue`**
3. Add `GEMINI_API_KEY` (and optionally `GROQ_API_KEY`) as environment variables
4. Deploy — auto-redeploys on every push

## 🎬 Demo tips

- **"Assignment email"** chip → shows extension-request auto-draft + Add to Calendar
- **"Interview WhatsApp"** chip → shows confirmation auto-draft
- **"WhatsApp group"** chip → shows how buried group-chat deadlines get extracted
- **Read aloud** → fires Hindi voice for Hindi/Hinglish messages; English otherwise
- **Add to Calendar** → only shows if AI extracts a precise date — demonstrates structured extraction quality

## 🔑 Environment variables

| Variable | Required | Where |
|---|---|---|
| `GEMINI_API_KEY` | Yes | https://aistudio.google.com/app/apikey (free) |
| `GROQ_API_KEY` | Recommended | https://console.groq.com/keys (free) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | No | https://upstash.com (rate limiting) |
