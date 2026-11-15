# World Radio Translator

Live-Radiosender aus aller Welt streamen und in Echtzeit in die gewählte Sprache übersetzen — mit KI (Gemini oder OpenAI-kompatible Anbieter).

## Funktionen

- Interaktive Weltkarte — klicken, um Sender in der Region zu finden.
- Live-Radio-Streaming mit CORS-/Mixed-Content-Proxy.
- YouTube-Live-Streams (Audio-Extraktion).
- Lokale Dateien hochladen, Kamera/Mikrofon als Quelle.
- Echtzeit-Sprachübersetzung: STT → LLM → TTS, mit Live-Transkript.
- Anti-Wiederholung mit Reim, Temperatur 0, keine Filler.
- Editierbare System-/User-Prompts und Temperatur für OpenAI LLM.
- TTS-Ducking und TTS-Geschwindigkeit (0.5–2x).
- Quell-Puffer (0–10s) mit automatischer Latenzmessung.
- Export: Transkript (TXT), Audio (WAV: Original / Übersetzung / Mix) und SRT-Untertitel.
- KI-Anbieter: Gemini (Server-Key) oder OpenAI-kompatible Endpunkte (LLM/STT/TTS).
- Modellsuche und Verbindungstest für OpenAI-kompatible Dienste.
- Serverseitige Speicherung der Einstellungen (pro Client-ID).
- Ereignislog-Panel mit Zeitstempeln und Kategorien.
- Dunkles/helles Theme, 3 UI-Sprachen (EN/RU/DE), 60+ Übersetzungssprachen.
- Android-App (Capacitor) mit vollem Funktionsumfang.

## Architektur

### Übersicht

```
┌─────────────────────────────────────────────────────────────┐
│  Browser / Android WebView (React + Vite)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ WorldMap     │  │ StationList  │  │ AudioPlayer      │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│  ┌──────┴─────────────────┴────────────────────┴─────────┐  │
│  │ App.tsx (State, Einstellungen, Live-Übersetzung)       │  │
│  └──────┬─────────────────────────────────────────────────┘  │
│         │                                                    │
│  ┌──────┴──────────┐  ┌──────────────────────────────────┐  │
│  │ liveTranslate   │  │ aiProviderSettings               │  │
│  │ Client (WS)     │  │ (localStorage + Server-Sync)     │  │
│  └──────┬──────────┘  └──────────────────────────────────┘  │
└─────────┼────────────────────────────────────────────────────┘
          │ WebSocket /api/live-stream  +  REST /api/*
┌─────────┴────────────────────────────────────────────────────┐
│  Express-Server (server.ts)                                   │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐ │
│  │ /api/geocode│ │/api/translate│ │/api/live- │ │/api/ai/* │ │
│  │             │ │             │ │ transcribe│ │ models   │ │
│  └──────┬─────┘ └──────┬─────┘ └─────┬─────┘ │ test     │ │
│         │               │             │       │ settings │ │
│  ┌──────┴───────────────┴─────────────┴───────┴──────────┐ │
│  │ safeGenerateContent / openAIChatCompletion / etc.     │ │
│  │ (Gemini oder OpenAI-kompatibel)                      │ │
│  └──────┬───────────────────────────────────────────────┘ │
│         │                                                  │
│  ┌──────┴──────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Stream-Proxy    │  │ YouTube      │  │ Einstell.-   │ │
│  │ /api/proxy-     │  │ Stream       │  │ speicher     │ │
│  │ stream          │  │ /api/youtube │  │ (JSON)       │ │
│  └─────────────────┘  └──────────────┘  └──────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Frontend (`src/`)

- **`App.tsx`** — Hauptkomponente: State, Theme, Stationsauswahl, Live-Übersetzung, Transkript-UI.
- **`components/`**
  - `WorldMap.tsx` — Interaktive Karte (Klick zur Regionsauswahl).
  - `StationList.tsx` — Liste von Radio/YouTube/lokalen Quellen mit Suche.
  - `AudioPlayer.tsx` — HTML5 Audio/Video-Player mit HLS.
  - `AudioVisualizerD3.tsx` — Echtzeit-Frequenzvisualisierer.
  - `AIProviderSettingsPanel.tsx` — Anbieter-Einstellungen, Modellsuche, Tests.
- **`services/`**
  - `liveTranslateClient.ts` — Audio-Aufnahme aus DOM, WebSocket-Streaming, Wiedergabe, WAV-Aufnahme.
  - `aiProviderSettings.ts` — Laden/Speichern (localStorage + Server-Sync).
- **`apiBase.ts`** — Backend-Basis-URL-Auflösung.
- **`i18n.ts` + `locales/`** — Lokalisierung (EN/RU/DE).
- **`types.ts`** — TypeScript-Interfaces.

### Backend (`server.ts`)

- Express-Server mit Vite-Middleware (Dev) / Static (Prod).
- WebSocket-Server auf `/api/live-stream` für Echtzeit-Übersetzung.
- REST-Endpunkte:
  - `POST /api/geocode` — Reverse-Geocoding + Kulturprofil.
  - `POST /api/ai/models` — Modellsuche für OpenAI-kompatible Dienste.
  - `POST /api/ai/test` — Test von LLM/STT/TTS-Endpunkten.
  - `GET/POST /api/settings` — Serverseitige Speicherung der Einstellungen.
  - `POST /api/translate` — Einmalige Textübersetzung.
  - `POST /api/live-transcribe` — Schrittweise Audio-Transkription/Übersetzung.
  - `POST /api/generate-feed` — Programmkarten-Generierung.
  - `GET /api/proxy-stream` — Stream-Proxy für CORS/Mixed Content.
  - `GET /api/youtube-stream` / `/api/youtube-search` — YouTube-Audio-Extraktion.
- Gemini-Integration über `@google/genai` mit Retry/Fallback.
- OpenAI-kompatible Integration: Chat Completions, Audio Transcriptions, Audio Speech.

### Android (`android/`)

Capacitor-basierter WebView-Wrapper. Berechtigungen: INTERNET, CAMERA, RECORD_AUDIO usw.

### Datenfluss (Live-Übersetzung)

1. Nutzer wählt einen Sender und klickt „Übersetzung starten“.
2. `liveTranslateClient.connect()` öffnet WebSocket zu `/api/live-stream`.
3. Server initialisiert KI-Anbieter (Gemini Live oder OpenAI-kompatible Pipeline).
4. Client erfasst PCM-Audio aus dem `<audio>`/`<video>`-Element jede Sekunde.
5. Audio-Chunks werden per WebSocket an den Server gesendet.
6. Server verarbeitet: STT → LLM-Übersetzung → TTS.
7. Übersetztes Audio + Transkript werden an den Client gesendet.
8. Client spielt übersetztes Audio ab und zeigt Transkript.

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

## Android-Build

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`

## TODO

### Hohe Priorität
- [ ] YouTube-Live-Übersetzung zuverlässiger machen (ytdl-core-Ausfälle).
- [ ] Offline-Caching für Senderlisten.
- [ ] Fehlerbehandlung und Wiederholungen bei Stream-Ausfällen verbessern.
- [ ] Quell-Verzögerung aus gemessener Latenz automatisch kalibrieren.

### Mittlere Priorität
- [ ] Weitere UI-Sprachen (Französisch, Spanisch usw.).
- [ ] MP3-Export implementieren (aktuell nur WAV).
- [ ] Playlisten/Favoriten für Sender.
- [ ] Push-Benachrichtigungen für neue Sendungen.

### Niedrige Priorität
- [ ] Unit-Tests für Services.
- [ ] E2E-Tests für kritische Abläufe.
- [ ] Barrierefreiheit verbessern (ARIA, Tastaturnavigation).
- [ ] PWA-Unterstützung (Service Worker, Manifest).
- [ ] Automatische Erkennung des System-Dark-Mode.
- [ ] SRT-Timing präzisieren (Turn-Start vs -Ende).

## Lizenz

MIT