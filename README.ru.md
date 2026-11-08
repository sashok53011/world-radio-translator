# World Radio Translator

Трансляция живых радиостанций со всего мира с синхронным переводом на выбранный язык с помощью AI (Gemini или OpenAI-совместимых сервисов).

## Возможности

- Интерактивная карта мира — кликните, чтобы найти радиостанции в регионе.
- Прямой эфир радио с прокси для CORS/mixed content.
- Поддержка YouTube Live (извлечение аудио).
- Загрузка локальных файлов и захват с камеры/микрофона.
- Перевод голоса в реальном времени: STT → LLM → TTS, с транскриптом.
- Экспорт транскрипта (копирование / TXT) и аудио (WAV: оригинал + перевод).
- Настройки AI-провайдера: Gemini (ключ на сервере) или OpenAI-совместимые эндпоинты (LLM/STT/TTS).
- Поиск моделей («Fetch model list») для OpenAI-совместимых сервисов.
- Тёмная/светлая тема, 60+ языков.
- Android-приложение (Capacitor) с полным функционалом.

## Запуск локально

**Требования:** Node.js 18+

1. Установите зависимости:
   ```bash
   npm install
   ```
2. Задайте `GEMINI_API_KEY` в `.env.local` (необязательно, для Gemini).
3. Запустите:
   ```bash
   npm run dev
   ```
   Откройте http://localhost:3000

## Сборка (production)

```bash
npm run build
NODE_ENV=production PORT=3000 npm run start
```

## AI-провайдеры

Откройте настройки (иконка шестерёнки):

- **Google Gemini** — использует серверный `GEMINI_API_KEY`.
- **OpenAI-совместимые** — отдельные эндпоинты для LLM, STT, TTS. Кнопка «Fetch model list» ищет модели.

Настройки и ключи хранятся в браузере (localStorage) и отправляются на сервер при необходимости.

## Android

Проект Capacitor в папке `android/`. Сборка:

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`

## Структура

```
server.ts          Бэкенд Express + WebSocket
src/
  App.tsx          Основной UI
  components/      WorldMap, StationList, AudioPlayer, ...
  services/        liveTranslateClient, aiProviderSettings
  locales/         en, ru, de
android/           Проект Capacitor Android
```

## Лицензия

MIT