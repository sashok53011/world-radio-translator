# World Radio Translator

Live-Radiosender aus aller Welt streamen und in Echtzeit in die gewählte Sprache übersetzen — mit KI (Gemini oder OpenAI-kompatible Anbieter).

## Funktionen

- Interaktive Weltkarte — klicken, um Sender in der Region zu finden.
- Live-Radio-Streaming mit CORS-/Mixed-Content-Proxy.
- YouTube-Live-Streams (Audio-Extraktion).
- Lokale Dateien hochladen, Kamera/Mikrofon als Quelle.
- Echtzeit-Sprachübersetzung: STT → LLM → TTS, mit Live-Transkript.
- Transkript-Export (Kopieren / TXT) und Audio-Export (WAV: Original + Übersetzung).
- KI-Anbieter: Gemini (Server-Key) oder OpenAI-kompatible Endpunkte (LLM/STT/TTS).
- Modellsuche („Fetch model list“) für OpenAI-kompatible Dienste.
- Dunkles/helles Theme, 60+ Sprachen.
- Android-App (Capacitor) mit vollem Funktionsumfang.

## Lokal starten

**Voraussetzungen:** Node.js 18+

1. Abhängigkeiten installieren:
   ```bash
   npm install
   ```
2. `GEMINI_API_KEY` in `.env.local` setzen (optional, für Gemini).
3. Starten:
   ```bash
   npm run dev
   ```
   Öffnen: http://localhost:3000

## Build (Production)

```bash
npm run build
NODE_ENV=production PORT=3000 npm run start
```

## KI-Anbieter

Einstellungen öffnen (Zahnrad-Symbol):

- **Google Gemini** — nutzt serverseitigen `GEMINI_API_KEY`.
- **OpenAI-kompatibel** — separate Endpunkte für LLM, STT, TTS. „Fetch model list“ sucht Modelle.

Einstellungen und API-Schlüssel werden im Browser (localStorage) gespeichert.

## Android

Capacitor-Projekt in `android/`. Build:

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`

## Struktur

```
server.ts          Backend (Express + WebSocket)
src/
  App.tsx          Haupt-UI
  components/      WorldMap, StationList, AudioPlayer, ...
  services/        liveTranslateClient, aiProviderSettings
  locales/         en, ru, de
android/           Capacitor-Android-Projekt
```

## Lizenz

MIT