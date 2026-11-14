# World Radio Translator

Stream live radio broadcasts from anywhere in the world and translate them into your chosen language in real time using AI (Gemini or OpenAI-compatible providers).

## Features

- Interactive world map — click anywhere to discover radio stations in that region.
- Live radio streaming with CORS/mixed-content proxy.
- YouTube Live stream support (audio extraction).
- Local file upload and camera/microphone capture as audio sources.
- Real-time voice translation: STT → LLM → TTS, with live transcript.
- Transcript export (copy / download TXT) and audio export (WAV: original + translated).
- AI provider settings: Gemini (server key) or OpenAI-compatible endpoints (LLM/STT/TTS).
- Model discovery ("Fetch model list") and connection test for OpenAI-compatible services.
- Server-side settings persistence (per client ID).
- Dark/light theme, 3 UI languages (EN/RU/DE), 60+ translation languages.
- Android app (Capacitor) with full functionality.

## Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Browser / Android WebView (React + Vite)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ WorldMap     │  │ StationList  │  │ AudioPlayer      │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│  ┌──────┴─────────────────┴────────────────────┴─────────┐  │
│  │ App.tsx (state, settings, live translation)            │  │
│  └──────┬─────────────────────────────────────────────────┘  │
│         │                                                    │
│  ┌──────┴──────────┐  ┌──────────────────────────────────┐  │
│  │ liveTranslate   │  │ aiProviderSettings               │  │
│  │ Client (WS)     │  │ (localStorage + server sync)     │  │
│  └──────┬──────────┘  └──────────────────────────────────┘  │
└─────────┼────────────────────────────────────────────────────┘
          │ WebSocket /api/live-stream  +  REST /api/*
┌─────────┴────────────────────────────────────────────────────┐
│  Express server (server.ts)                                   │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐ │
│  │ /api/geocode│ │/api/translate│ │/api/live- │ │/api/ai/* │ │
│  │             │ │             │ │ transcribe│ │ models   │ │
│  └──────┬─────┘ └──────┬─────┘ └─────┬─────┘ │ test     │ │
│         │               │             │       │ settings │ │
│  ┌──────┴───────────────┴─────────────┴───────┴──────────┐ │
│  │ safeGenerateContent / openAIChatCompletion / etc.     │ │
│  │ (Gemini or OpenAI-compatible)                        │ │
│  └──────┬───────────────────────────────────────────────┘ │
│         │                                                  │
│  ┌──────┴──────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Stream proxy    │  │ YouTube      │  │ Settings     │ │
│  │ /api/proxy-     │  │ stream       │  │ store (JSON) │ │
│  │ stream          │  │ /api/youtube │  │              │ │
│  └─────────────────┘  └──────────────┘  └──────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Frontend (`src/`)

- **`App.tsx`** — main component: state, theme, station selection, live translation orchestration, transcript UI.
- **`components/`**
  - `WorldMap.tsx` — interactive map (click to select region).
  - `StationList.tsx` — radio/YouTube/local media source list with search.
  - `AudioPlayer.tsx` — HTML5 audio/video player with HLS support.
  - `AudioVisualizerD3.tsx` — real-time frequency visualizer.
  - `AIProviderSettingsPanel.tsx` — provider settings UI with model discovery and tests.
- **`services/`**
  - `liveTranslateClient.ts` — audio capture from DOM media element, WebSocket streaming, playback of translated audio, WAV recording.
  - `aiProviderSettings.ts` — settings load/save (localStorage + server sync).
- **`apiBase.ts`** — backend base URL resolution (localStorage → env → relative).
- **`i18n.ts` + `locales/`** — i18n (EN/RU/DE).
- **`types.ts`** — TypeScript interfaces.

### Backend (`server.ts`)

- Express server with Vite middleware (dev) / static (prod).
- WebSocket server on `/api/live-stream` for real-time translation.
- REST endpoints:
  - `POST /api/geocode` — reverse geocoding + cultural profile generation.
  - `POST /api/ai/models` — model discovery for OpenAI-compatible services.
  - `POST /api/ai/test` — test LLM/STT/TTS endpoints.
  - `GET/POST /api/settings` — server-side settings persistence.
  - `POST /api/translate` — one-shot text translation.
  - `POST /api/live-transcribe` — chunked audio transcription/translation.
  - `POST /api/generate-feed` — program insights generation.
  - `GET /api/proxy-stream` — stream proxy for CORS/mixed content.
  - `GET /api/youtube-stream` / `/api/youtube-search` — YouTube audio extraction.
- Gemini integration via `@google/genai` with retry/fallback logic.
- OpenAI-compatible integration: chat completions, audio transcriptions, audio speech.

### Android (`android/`)

Capacitor-based WebView wrapper. Permissions: INTERNET, CAMERA, RECORD_AUDIO, etc.

### Data Flow (Live Translation)

1. User selects a station and clicks "Start Live Translation".
2. `liveTranslateClient.connect()` opens WebSocket to `/api/live-stream`.
3. Server initializes AI provider (Gemini Live or OpenAI-compatible pipeline).
4. Client captures PCM audio from the `<audio>`/`<video>` element every 1s.
5. Audio chunks sent to server via WebSocket.
6. Server processes: STT → LLM translation → TTS.
7. Translated audio + transcript sent back to client.
8. Client plays translated audio and displays transcript.

## Run Locally

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```bash
   npm install
   ```
2. Set `GEMINI_API_KEY` in `.env.local` (optional, for Gemini provider).
3. Run:
   ```bash
   npm run dev
   ```
   Open http://localhost:3000

## Build (Production)

```bash
npm run build
NODE_ENV=production PORT=3000 npm run start
```

## Android Build

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`

## TODO

### High Priority
- [ ] Improve YouTube translation reliability (ytdl-core breakage).
- [ ] Add offline caching for radio station lists.
- [ ] Optimize mobile UI for small screens (6" phones).
- [ ] Add proper error handling and retry for stream failures.

### Medium Priority
- [ ] Add more UI languages (French, Spanish, etc.).
- [ ] Implement MP3 export (currently only WAV).
- [ ] Add playlist/favorites for stations.
- [ ] Improve audio sync (video delay auto-calibration).
- [ ] Add push notifications for new broadcasts.

### Low Priority
- [ ] Add unit tests for services.
- [ ] Add E2E tests for critical flows.
- [ ] Improve accessibility (ARIA labels, keyboard navigation).
- [ ] Add PWA support (service worker, manifest).
- [ ] Dark mode auto-detection from system preferences.

## License

MIT