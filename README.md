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
- Model discovery ("Fetch model list") for OpenAI-compatible services.
- Dark/light theme, 60+ languages.
- Android app (Capacitor) with full functionality.

## Run Locally

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```bash
   npm install
   ```
2. Set `GEMINI_API_KEY` in `.env.local` (optional, for Gemini provider).
3. Run the app:
   ```bash
   npm run dev
   ```
   Open http://localhost:3000

## Build (production)

```bash
npm run build
NODE_ENV=production PORT=3000 npm run start
```

## AI Providers

Open **AI provider settings** (gear icon) to choose:

- **Google Gemini** — uses server-side `GEMINI_API_KEY`.
- **OpenAI-compatible** — configure separate endpoints for LLM, STT, TTS (chat completions, audio transcriptions, audio speech). Use "Fetch model list" to discover models.

Settings and API keys are stored in the browser (localStorage) and sent to the app server when needed.

## Android

A Capacitor-based Android project is in `android/`. Build:

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`

## Project Structure

```
server.ts          Express + WebSocket backend
src/
  App.tsx          Main UI
  components/      WorldMap, StationList, AudioPlayer, ...
  services/        liveTranslateClient, aiProviderSettings
  locales/         en, ru, de
android/           Capacitor Android project
```

## License

MIT