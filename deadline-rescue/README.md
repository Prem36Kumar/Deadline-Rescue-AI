# ⏰ Deadline Rescue AI

> Paste any message. Know exactly what to do. — Built for Vibe2Ship Hackathon PS1

## What it does
Paste any SMS, WhatsApp, email, or screenshot containing a deadline. The AI agent:
1. **Extracts** the deadline, urgency, and consequences using Gemini 2.5 Flash function calling
2. **Auto-generates** a smart step-by-step subtask breakdown — no button click needed
3. **Calculates** leave-by time with live map if travel is required
4. **Drafts** a ready-to-send WhatsApp/email response
5. **Saves** everything to Firebase Firestore Mission Control dashboard

## Agentic Architecture
- **Gemini 2.5 Flash** with native function calling (`save_deadline_result` tool)
- **Auto-chained**: extraction → breakdown → travel detection happen automatically
- **Groq fallback**: if Gemini is overloaded, Groq llama-3.3-70b takes over silently
- **Retry logic**: 503 overload → 2.5s wait → retry → fallback

## Google Technologies Used
- Gemini 2.5 Flash (primary AI — function calling + image understanding)
- Firebase Firestore (dashboard persistence)
- Google Maps (directions link)

## Features
- 📋 Paste text or upload screenshot/photo
- 🎙 Voice input (en-IN)
- ⏱ Live countdown timer
- 🧩 Auto AI subtask breakdown (no button needed)
- 🗺 Leave-by travel calculator (OpenRouteService + Leaflet)
- ✉️ Auto-drafted WhatsApp/email message
- 📊 Mission Control dashboard (Firebase)
- 🔔 Browser push notification 1hr before deadline
- 📅 Calendar (.ics) download

## Stack
Next.js 14 · TypeScript · Tailwind · Gemini 2.5 Flash · Firebase · Groq · OpenRouteService

## Setup
```bash
cp .env.local.example .env.local
# Add: GEMINI_API_KEY, GROQ_API_KEY, ORS_API_KEY, NEXT_PUBLIC_FIREBASE_*
npm install && npm run dev
```
