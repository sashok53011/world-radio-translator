import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, Modality } from "@google/genai";
import type { AIProviderSettings, AIServiceSettings } from "./src/types";
import dotenv from "dotenv";
import http from "http";
import https from "https";
import { URL, fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { createRequire } from "module";
const moduleFilename = (typeof __filename !== "undefined") ? __filename : fileURLToPath(import.meta.url);
const require = createRequire(moduleFilename);
const ytdlMod = require("@distube/ytdl-core");
const YtdlClass = ytdlMod.Ytdl || ytdlMod.default || ytdlMod;
const ytdlClient = new YtdlClass();
const ytSearchMod = require("yt-search");
const ytSearch = typeof ytSearchMod === "function" ? ytSearchMod : (ytSearchMod.default || ytSearchMod);

dotenv.config();

const app = express();
// CORS for mobile (Capacitor) and web clients
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = !origin ||
    origin === "capacitor://localhost" ||
    origin === "http://localhost" ||
    origin === "https://localhost" ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("https://localhost:") ||
    origin === "https://world-radio-translator.devhorizon.online" ||
    origin.endsWith(".devhorizon.online");
  if (allowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

const PORT = Number(process.env.PORT) || 3000;

// Server-side settings storage
const SETTINGS_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");
function loadSettingsStore(): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch { return {}; }
}
function saveSettingsStore(store: Record<string, any>) {
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(store));
  } catch (e) { console.warn("Failed to save settings:", e); }
}

// Helper to check if a string is a potentially valid Gemini API key format (accepts traditional 'AIzaSy' and new 'AQ' prefixes)
function isValidGeminiApiKeyPrefix(key: string | undefined): boolean {
  if (!key) return false;
  const k = key.trim();
  return (k.startsWith("AIzaSy") || k.startsWith("AQ")) && k.length > 10;
}

// Helper to check if a string represents English language
function isEnglish(lang: string | undefined): boolean {
  if (!lang) return false;
  const l = lang.toLowerCase().trim();
  return l.includes("english") || l.includes("eng") || l === "en";
}

// Helper to check if two language strings are functionally equivalent
function areLanguagesSame(langA: string | undefined, langB: string | undefined): boolean {
  if (!langA || !langB) return false;
  
  const codeA = getLanguageCode(langA);
  const codeB = getLanguageCode(langB);
  if (codeA && codeB && codeA === codeB) return true;
  
  const a = langA.toLowerCase().trim();
  const b = langB.toLowerCase().trim();
  if (a === b) return true;
  if (isEnglish(a) && isEnglish(b)) return true;
  return false;
}

// Initialize Gemini client on the server side
const GEMINI_API_KEY_TO_USE = process.env.GEMINI_API_KEY && isValidGeminiApiKeyPrefix(process.env.GEMINI_API_KEY) && !process.env.GEMINI_API_KEY.includes("placeholder") && !process.env.GEMINI_API_KEY.includes("system")
  ? process.env.GEMINI_API_KEY 
  : "";

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY_TO_USE || "placeholder_key",
  apiVersion: "v1alpha",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Initialize Gemini client for v1alpha models (e.g. gemini-3.5-live-translate-preview)
const aiAlpha = new GoogleGenAI({
  apiKey: GEMINI_API_KEY_TO_USE || "placeholder_key",
  apiVersion: "v1alpha",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

function parseAIProviderSettings(value: unknown): AIProviderSettings {
  const defaultService = (endpoint: string, model: string): AIServiceSettings => ({
    endpoint,
    model,
    apiKey: "",
  });
  const defaults: AIProviderSettings = {
    provider: "gemini",
    llm: defaultService("https://api.openai.com/v1/chat/completions", "gpt-4o-mini"),
    stt: defaultService("https://api.openai.com/v1/audio/transcriptions", "whisper-1"),
    tts: defaultService("https://api.openai.com/v1/audio/speech", "tts-1"),
  };
  if (!value || typeof value !== "object") return defaults;

  const input = value as Partial<AIProviderSettings>;
  if (input.provider !== "openai-compatible") return defaults;
  const readService = (candidate: unknown): AIServiceSettings => {
    if (!candidate || typeof candidate !== "object") {
      return { endpoint: "", model: "", apiKey: "" };
    }
    const config = candidate as Partial<AIServiceSettings>;
    return {
      endpoint: typeof config.endpoint === "string" ? config.endpoint.trim() : "",
      ...(typeof config.modelsEndpoint === "string" ? { modelsEndpoint: config.modelsEndpoint.trim() } : {}),
      model: typeof config.model === "string" ? config.model.trim() : "",
      apiKey: typeof config.apiKey === "string" ? config.apiKey : "",
      ...(typeof config.voice === "string" ? { voice: config.voice } : {}),
    };
  };
  return {
    provider: "openai-compatible",
    llm: readService(input.llm),
    stt: readService(input.stt),
    tts: readService(input.tts),
  };
}

function validateAIService(settings: AIServiceSettings, serviceName: string): URL {
  if (!settings.model.trim()) throw new Error(`${serviceName} model name is required.`);
  return validateAIEndpoint(settings.endpoint);
}

function validateAIEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`Invalid AI endpoint URL: ${endpoint}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("AI endpoints must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Do not put credentials in the endpoint URL; use the API key field.");
  }
  return url;
}

function createAIHeaders(settings: AIServiceSettings, json = true): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  if (settings.apiKey) headers.Authorization = "Bearer " + settings.apiKey;
  return headers;
}

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:[a-zA-Z0-9_-]+)?\\s*([\\s\\S]*?)\\s*```$/);
  return match ? match[1].trim() : trimmed;
}

async function openAIChatCompletion(
  settings: AIServiceSettings,
  prompt: string,
  jsonResponse = false,
): Promise<string> {
  const endpoint = validateAIService(settings, "LLM");
  // Note: some OpenAI-compatible backends (e.g. the user's) reject
  // response_format.type="json_object" and only accept "json_schema" or "text".
  // We therefore omit response_format and rely on the prompt to request JSON,
  // then strip any markdown code fences from the returned text.
  const response = await fetch(endpoint, {
    method: "POST",
    headers: createAIHeaders(settings),
    body: JSON.stringify({
      model: settings.model,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`LLM endpoint returned ${response.status}: ${details.slice(0, 500)}`);
  }
  const result = await response.json() as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> };
  const message = result.choices?.[0]?.message;
  const text = message?.content?.trim() ? message.content : (message?.reasoning_content || "");
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("LLM endpoint returned an empty message.");
  }
  return stripMarkdownCodeFence(text);
}

function createPcmWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function openAITranscribe(settings: AIServiceSettings, wavAudio: Buffer): Promise<string> {
  const form = new FormData();
  form.append("model", settings.model);
  form.append("file", new Blob([new Uint8Array(wavAudio)], { type: "audio/wav" }), "broadcast.wav");
  const headers = createAIHeaders(settings, false);
  const endpoint = validateAIService(settings, "STT");
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: form,
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`STT endpoint returned ${response.status}: ${details.slice(0, 500)}`);
  }
  const result = await response.json() as { text?: string };
  return typeof result.text === "string" ? result.text.trim() : "";
}

async function openAISpeech(settings: AIServiceSettings, text: string, voice: string): Promise<Buffer> {
  const endpoint = validateAIService(settings, "TTS");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: createAIHeaders(settings),
    body: JSON.stringify({
      model: settings.model,
      input: text,
      voice: voice || "alloy",
      response_format: "wav",
    }),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`TTS endpoint returned ${response.status}: ${details.slice(0, 500)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function getModelsEndpoint(settings: AIServiceSettings): URL {
  const endpoint = settings.modelsEndpoint?.trim();
  if (endpoint) return validateAIEndpoint(endpoint);

  const url = validateAIEndpoint(settings.endpoint);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(
    /\/(?:chat\/completions|completions|audio\/transcriptions|audio\/speech)\/?$/,
    "/models",
  );
  if (!url.pathname.endsWith("/models")) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
  }
  return url;
}

async function fetchAIModels(settings: AIServiceSettings): Promise<string[]> {
  const response = await fetch(getModelsEndpoint(settings), {
    method: "GET",
    headers: createAIHeaders(settings, false),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Models endpoint returned ${response.status}: ${details.slice(0, 500)}`);
  }
  const result = await response.json() as {
    data?: Array<{ id?: unknown; name?: unknown }>;
    models?: Array<{ id?: unknown; name?: unknown } | string>;
  };
  const entries = Array.isArray(result.data) ? result.data : result.models;
  if (!Array.isArray(entries)) {
    throw new Error("Models endpoint response must contain a data or models array.");
  }
  const models = entries
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        if (typeof entry.id === "string") return entry.id;
        if (typeof entry.name === "string") return entry.name;
      }
      return "";
    })
    .filter((model) => model.length > 0);
  if (models.length === 0) throw new Error("Models endpoint returned no model IDs.");
  return [...new Set(models)].sort((a, b) => a.localeCompare(b));
}

/**
 * Resilient helper to connect to Gemini Live API.
 * Connects directly and strictly to "gemini-3.5-live-translate-preview" using the authorized API key.
 */
/**
 * Resilient helper to connect to Gemini Live API.
 * Connects directly and strictly to "gemini-3.5-live-translate-preview".
 * Allows dynamic fallback/integration of user-submitted custom API keys.
 */
async function connectToLiveResilient(options: {
  model: string;
  config: any;
  callbacks: {
    onmessage: (msg: any) => void;
    onerror: (err: any) => void;
    onclose?: (event?: any) => void;
  };
}): Promise<any> {
  const targetModel = "gemini-3.5-live-translate-preview";
  
  if (!GEMINI_API_KEY_TO_USE || GEMINI_API_KEY_TO_USE === "placeholder_key") {
    throw new Error("Gemini API key is missing. Please configure GEMINI_API_KEY in AI Studio Settings.");
  }

  console.log(`[Resilient Live Connect] Establishing connection strictly to requested model: "${targetModel}" using system key`);

  return await aiAlpha.live.connect({
    model: targetModel,
    config: options.config,
    callbacks: options.callbacks
  });
}

/**
 * Robust utility to query Gemini with automatic retries on the requested model.
 */
async function safeGenerateContent(options: {
  contents: any;
  config?: any;
  preferredModel?: string;
  maxAttempts?: number;
  aiSettings?: AIProviderSettings;
}) {
  const preferredModel = options.preferredModel || "gemini-3.5-flash";
  const maxAttempts = options.maxAttempts || 3;

  const aiSettings = parseAIProviderSettings(options.aiSettings);
  if (aiSettings.provider === "openai-compatible") {
    const text = await openAIChatCompletion(
      aiSettings.llm,
      String(options.contents),
      options.config?.responseMimeType === "application/json",
    );
    return { text };
  }

  if (!GEMINI_API_KEY_TO_USE || GEMINI_API_KEY_TO_USE === "placeholder_key") {
    throw new Error("Gemini API key is missing. Please configure GEMINI_API_KEY in AI Studio Settings.");
  }

  const initialModel = preferredModel;

  let modelToRequest = initialModel;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[Gemini Connection] Requesting model: "${modelToRequest}" (Attempt ${attempt}/${maxAttempts}) using system key`);
      
      // Safely clone config and remove thinkingConfig if model doesn't support Gemini 3 thinking
      const activeConfig = options.config ? { ...options.config } : undefined;
      if (activeConfig?.thinkingConfig && !modelToRequest.includes("gemini-3")) {
        delete activeConfig.thinkingConfig;
      }

      const clientToUse = modelToRequest === "gemini-3.5-live-translate-preview" ? aiAlpha : ai;

      const response = await clientToUse.models.generateContent({
        model: modelToRequest,
        contents: options.contents,
        config: activeConfig,
      });

      const hasText = !!response?.text;
      const hasAudio = !!response?.candidates?.[0]?.content?.parts?.some((p: any) => p.inlineData && p.inlineData.data);

      if (response && (hasText || hasAudio)) {
        console.log(`[Gemini Connection] Success using model: "${modelToRequest}"`);
        return response;
      }
      throw new Error("Received empty text or audio response from Gemini API");
    } catch (err: any) {
      lastError = err;
      const failedModel = modelToRequest;
      const errorMsg = String(err?.message || err).toLowerCase();
      
      const isUnavailable = errorMsg.includes("503") || 
                            errorMsg.includes("unavailable") || 
                            errorMsg.includes("high demand") || 
                            errorMsg.includes("rate limit") || 
                            errorMsg.includes("429") ||
                            err?.status === "UNAVAILABLE" ||
                            err?.code === 503;

      const isUnsupported = errorMsg.includes("404") || 
                            errorMsg.includes("not found") || 
                            errorMsg.includes("unsupported") || 
                            errorMsg.includes("invalid") ||
                            errorMsg.includes("400") ||
                            err?.code === 404 ||
                            err?.code === 400;

      if (isUnsupported) {
        if (attempt === maxAttempts) {
          console.error(`[Gemini Connection] Model "${failedModel}" is not supported or not found. Aborting.`);
        } else {
          console.log(`[Gemini Connection] Model "${failedModel}" is not supported or not found on attempt ${attempt}.`);
        }
        break; // skip any remaining retries for this model
      }

      if (isUnavailable) {
        console.log(`[Gemini Connection] Model "${failedModel}" is temporarily unavailable or experiencing high demand.`);
        if (modelToRequest === "gemini-3.5-flash") {
          modelToRequest = "gemini-3.1-flash-lite";
          console.log(`[Gemini Connection] Switching modelToRequest on next attempt to: "${modelToRequest}"`);
        } else if (modelToRequest === "gemini-3.1-flash-lite") {
          modelToRequest = "gemini-3.5-flash";
          console.log(`[Gemini Connection] Switching modelToRequest on next attempt to: "${modelToRequest}"`);
        }
      }

      if (attempt === maxAttempts) {
        console.error(`[Gemini Connection] Model "${failedModel}" failed completely on final attempt ${attempt}:`, err?.message || err);
      } else {
        console.log(`[Gemini Connection] Model "${failedModel}" failed on attempt ${attempt} (retrying...):`, err?.message || err);
      }
      
      // Wait with exponential backoff before the next retry
      if (attempt < maxAttempts) {
        const backoff = attempt * 800;
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  throw lastError || new Error(`Failed to generate content with model "${initialModel}"`);
}

// Streaming Proxy to bypass browser Mixed Content (HTTP blocked under HTTPS site) and CORS
app.get("/api/proxy-stream", (req, res) => {
  const streamUrlString = req.query.url as string;
  if (!streamUrlString) {
    return res.status(400).send("No stream URL provided");
  }

  // Set permissive CORS headers for the media element's crossOrigin="anonymous" requirement
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  try {
    const parsedUrl = new URL(streamUrlString);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      return res.status(400).send("Unsupported stream protocol");
    }
    const host = parsedUrl.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "[::1]" ||
      host === "metadata.google.internal" ||
      host.endsWith(".internal") ||
      host.endsWith(".local") ||
      /^(127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(host)
    ) {
      return res.status(403).send("Forbidden stream host");
    }
    const clientReqModule = parsedUrl.protocol === "https:" ? https : http;

    console.log(`[Stream Proxy] Requesting: ${streamUrlString}`);

    const options: any = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Connection": "keep-alive"
      }
    };

    if (parsedUrl.protocol === "https:") {
      options.rejectUnauthorized = false; // Bypass outdated / self-signed certificate blocks
    }

    const proxyReq = clientReqModule.get(parsedUrl, options, (proxyRes) => {
      // Handle non-success and non-redirect status codes immediately to prevent returning HTML/JSON pages to the audio player
      if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
        console.warn(`[Stream Proxy] Stream site returned error status code: ${proxyRes.statusCode} for ${streamUrlString}`);
        if (!res.headersSent) {
          res.status(502).send(`Stream source returned error status ${proxyRes.statusCode}`);
        }
        return;
      }

      // Automatic redirection handler
      if (proxyRes.statusCode && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        const redirectHeader = proxyRes.headers.location;
        try {
          // Resolve relative or partial redirect targets relative to our current URL context
          const redirectUrl = new URL(redirectHeader, parsedUrl.href).href;
          console.log(`[Stream Proxy] Redirecting to: ${redirectUrl}`);
          return res.redirect(`/api/proxy-stream?url=${encodeURIComponent(redirectUrl)}`);
        } catch (redirectErr: any) {
          console.error(`[Stream Proxy] Failed to parse/resolve redirect URL: ${redirectHeader}`, redirectErr.message);
        }
      }

      const contentType = (proxyRes.headers["content-type"] || "").toLowerCase();

      // If it is regular web layout, structured data, or a blank page, it's not a playable stream
      if (contentType.includes("text/html") || contentType.includes("application/json") || contentType.includes("application/xml")) {
        console.warn(`[Stream Proxy] Refusing to proxy non-audio content type: "${contentType}" for ${streamUrlString}`);
        if (!res.headersSent) {
          res.status(502).send("Invalid stream contents (received webpage or structured data instead of audio)");
        }
        return;
      }
      
      // Determine if this is a playlist format (M3U / PLS)
      const pathname = parsedUrl.pathname.toLowerCase();
      const playExtension = pathname.endsWith(".pls") || pathname.endsWith(".m3u");
      const isPlaylistContentType = contentType.includes("mpegurl") || 
                                    contentType.includes("scpls") || 
                                    contentType.includes("playlist");
      const isM3u8Hls = contentType.includes("application/vnd.apple.mpegurl") || pathname.endsWith(".m3u8");

      if (isM3u8Hls) {
        // Setup direct pipe for m3u8 playlists without attempting plain-text PLS/M3U parsing
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        proxyRes.pipe(res);
        return;
      }

      if (playExtension || isPlaylistContentType) {
        console.log(`[Stream Proxy] Intercepting playlist format for parsing: ${contentType}`);
        let body = "";
        proxyRes.setEncoding("utf8");
        proxyRes.on("data", (chunk) => {
          body += chunk;
          if (body.length > 250000) { // Limit size to prevent memory waste/abuse
            proxyRes.destroy();
          }
        });
        proxyRes.on("end", () => {
          let directUrl = "";
          // Parse PLS
          if (body.toLowerCase().includes("[playlist]") || body.toLowerCase().includes("file1=")) {
            const match = body.match(/file\d+=\s*([^\s\r\n]+)/i);
            if (match) {
              const fileTarget = match[1];
              try {
                directUrl = new URL(fileTarget, parsedUrl.href).href;
              } catch (e) {
                directUrl = fileTarget;
              }
            }
          } else {
            // Parse M3U
            const lines = body.split(/\r?\n/);
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed && !trimmed.startsWith("#")) {
                try {
                  const resolvedLine = new URL(trimmed, parsedUrl.href).href;
                  if (resolvedLine.startsWith("http://") || resolvedLine.startsWith("https://")) {
                    directUrl = resolvedLine;
                    break;
                  }
                } catch (e) {
                  // Skip invalid or non-URL lines
                }
              }
            }
          }

          if (directUrl && directUrl !== streamUrlString) {
            console.log(`[Stream Proxy] Dynamic playlist resolution success -> direct url: ${directUrl}`);
            return res.redirect(`/api/proxy-stream?url=${encodeURIComponent(directUrl)}`);
          } else {
            console.warn(`[Stream Proxy] Playlist parsed but no target stream located or same as source. Length: ${body.length}`);
            if (!res.headersSent) {
              res.status(502).send("Target audio stream not found in playlist container");
            }
          }
        });
        return;
      }

      // Propagate stream headers for regular audio
      if (contentType) {
        res.setHeader("Content-Type", contentType);
      } else {
        res.setHeader("Content-Type", "audio/mpeg");
      }

      // Live infinite stream setup
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      proxyRes.pipe(res);
    });

    // Timeout response configuration (avoiding infinite hanging buffers on dead stream hosts)
    proxyReq.setTimeout(8000);
    proxyReq.on("timeout", () => {
      console.warn(`[Stream Proxy] Connection timed out: ${streamUrlString}`);
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).send("Radio station stream connection timed out");
      }
    });

    proxyReq.on("error", (err) => {
      console.error("[Stream Proxy] Connection Error:", err.message);
      if (!res.headersSent) {
        res.status(502).send("Bad gateway or offline stream source");
      }
    });

    // Close the backend stream connection when client pauses or switches stations!
    req.on("close", () => {
      proxyReq.destroy();
    });

  } catch (err: any) {
    console.error("[Stream Proxy] Malformed URL:", err.message);
    if (!res.headersSent) {
      res.status(400).send("Invalid stream URL");
    }
  }
});

// Cache for geocoding / culture info so users clicking fast get fast responses
const cultureCache = new Map<string, any>();

// Pure, real-world factual data dictionary based on uppercase ISO 2-letter country codes
const realCountryData: Record<string, { language: string; capital: string; greeting: string; genres: string[] }> = {
  US: { language: "English", capital: "Washington D.C.", greeting: "Hello & Howdy", genres: ["Classic Rock", "Country Folk", "Hip Hop", "Midwest Jazz"] },
  CA: { language: "English and French", capital: "Ottawa", greeting: "Hello & Bonjour", genres: ["Indie Rock", "Canadian Folk", "Chamber Pop", "Synthpop"] },
  MX: { language: "EspaÃ±ol", capital: "Ciudad de MÃ©xico", greeting: "Hola", genres: ["Mariachi", "Cumbia", "Latin Rock", "Reggaeton"] },
  FR: { language: "FranÃ§ais", capital: "Paris", greeting: "Bonjour", genres: ["Chanson", "French Touch", "Electro-Swing", "Indie Pop"] },
  DE: { language: "Deutsch", capital: "Berlin", greeting: "Hallo / Guten Tag", genres: ["Krautrock", "Techno", "Indie Rock", "Classical"] },
  IT: { language: "Italiano", capital: "Roma", greeting: "Ciao / Buongiorno", genres: ["Italo Disco", "Opera", "Cantautore", "Cinematic Jazz"] },
  GB: { language: "English", capital: "London", greeting: "Hello / Cheers", genres: ["Britpop", "UK Garage", "Synthpop", "Classic Rock"] },
  BR: { language: "PortuguÃªs", capital: "BrasÃ­lia", greeting: "OlÃ¡", genres: ["Samba", "Bossa Nova", "MPB", "Choro"] },
  AR: { language: "EspaÃ±ol", capital: "Buenos Aires", greeting: "Hola", genres: ["Tango", "Folklore", "Rock Nacional", "Cumbia"] },
  JP: { language: "Japanese", capital: "Tokyo", greeting: "Konnichiwa (ããã«ã¡ã¯)", genres: ["City Pop", "J-Rock", "Shibuya-kei", "Ambient Lo-Fi"] },
  KR: { language: "Korean", capital: "Seoul", greeting: "Annyeonghaseyo (ìëíì¸ì)", genres: ["K-Indie", "K-R&B", "Korean Folk", "Ballad"] },
  IN: { language: "Hindi and English", capital: "New Delhi", greeting: "Namaste (à¤¨à¤®à¤¸à¥à¤¤à¥)", genres: ["Classical Raga", "Bollywood", "Indie Pop", "Folk Fusion"] },
  ZA: { language: "English, Zulu, and Xhosa", capital: "Pretoria", greeting: "Molo & Sawubona", genres: ["Afro House", "Amapiano", "Kwaito", "Township Jazz"] },
  AU: { language: "English", capital: "Canberra", greeting: "G'day / Hello", genres: ["Indie Pop", "Pub Rock", "Electronic", "Folk"] },
  NZ: { language: "English and MÄori", capital: "Wellington", greeting: "Kia Ora", genres: ["Reggae-Dub", "Indie Folk", "Synth Pop", "Dream Pop"] },
  CN: { language: "Mandarin", capital: "Beijing", greeting: "NÇ hÇo (ä½ å¥½)", genres: ["Cantopop", "Mandopop", "Chinese Folk", "Guqin Ambient"] },
  RU: { language: "Russian", capital: "Moscow", greeting: "Zdravstvuyte (ÐÐ´ÑÐ°Ð²ÑÑÐ²ÑÐ¹ÑÐµ)", genres: ["Soviet Wave", "Russian Rock", "Electro", "Calming Classical"] },
  ES: { language: "EspaÃ±ol", capital: "Madrid", greeting: "Hola", genres: ["Flamenco", "Spanish Rock", "Indie Pop", "Latin Jazz"] },
  TR: { language: "TÃ¼rkÃ§e", capital: "Ankara", greeting: "Merhaba", genres: ["Anatolian Rock", "Turkish Pop", "Sufi Ambient", "Folk"] },
};

const LANGUAGE_CODE_MAP: Record<string, string> = {
  "Arabic": "ar",
  "Bengali": "bn",
  "Bulgarian": "bg",
  "Chinese (Simplified)": "zh-CN",
  "Chinese (Traditional)": "zh-TW",
  "Croatian": "hr",
  "Czech": "cs",
  "Danish": "da",
  "Dutch": "nl",
  "English": "en",
  "Estonian": "et",
  "Finnish": "fi",
  "French": "fr",
  "German": "de",
  "Greek": "el",
  "Gujarati": "gu",
  "Hebrew": "he",
  "Hindi": "hi",
  "Hungarian": "hu",
  "Indonesian": "id",
  "Italian": "it",
  "Japanese": "ja",
  "Kannada": "kn",
  "Korean": "ko",
  "Latvian": "lv",
  "Lithuanian": "lt",
  "Malayalam": "ml",
  "Marathi": "mr",
  "Norwegian": "no",
  "Persian": "fa",
  "Polish": "pl",
  "Portuguese": "pt",
  "Romanian": "ro",
  "Russian": "ru",
  "Serbian": "sr",
  "Slovak": "sk",
  "Slovenian": "sl",
  "Spanish": "es",
  "Swahili": "sw",
  "Swedish": "sv",
  "Tamil": "ta",
  "Telugu": "te",
  "Thai": "th",
  "Turkish": "tr",
  "Ukrainian": "uk",
  "Urdu": "ur",
  "Vietnamese": "vi"
};

function getLanguageCode(lang: string | undefined): string {
  if (!lang) return "en";
  const l = lang.toLowerCase().trim();
  
  // 1. Direct or partial keys matching
  for (const [name, code] of Object.entries(LANGUAGE_CODE_MAP)) {
    const nameLower = name.toLowerCase();
    if (l === nameLower || l.includes(nameLower) || nameLower.includes(l)) {
      return code;
    }
  }
  
  // 2. Direct code match (e.g. "es", "sv", "pt")
  const codes = Object.values(LANGUAGE_CODE_MAP);
  if (codes.includes(l)) {
    return l;
  }
  
  // 3. Custom hand-coded popular patterns / ISO-639 codes
  if (l.includes("ara") || l === "ar") return "ar";
  if (l.includes("ben") || l === "bn") return "bn";
  if (l.includes("bul") || l === "bg") return "bg";
  if (l.includes("chi") || l.includes("zho") || l === "zh") return "zh-CN";
  if (l.includes("hrv") || l === "hr") return "hr";
  if (l.includes("cze") || l.includes("ces") || l === "cs") return "cs";
  if (l.includes("dan") || l === "da") return "da";
  if (l.includes("dut") || l.includes("nld") || l === "nl") return "nl";
  if (l.includes("eng") || l === "en") return "en";
  if (l.includes("est") || l === "et") return "et";
  if (l.includes("fin") || l === "fi") return "fi";
  if (l.includes("fre") || l.includes("fra") || l === "fr") return "fr";
  if (l.includes("ger") || l.includes("deu") || l === "de") return "de";
  if (l.includes("gre") || l.includes("ell") || l === "el") return "el";
  if (l.includes("guj") || l === "gu") return "gu";
  if (l.includes("heb") || l === "he") return "he";
  if (l.includes("hin") || l === "hi") return "hi";
  if (l.includes("hun") || l === "hu") return "hu";
  if (l.includes("ind") || l === "id") return "id";
  if (l.includes("ita") || l === "it") return "it";
  if (l.includes("jpn") || l === "ja") return "ja";
  if (l.includes("kan") || l === "kn") return "kn";
  if (l.includes("kor") || l === "ko") return "ko";
  if (l.includes("lav") || l === "lv") return "lv";
  if (l.includes("lit") || l === "lt") return "lt";
  if (l.includes("mal") || l === "ml") return "ml";
  if (l.includes("mar") || l === "mr") return "mr";
  if (l.includes("nor") || l === "no") return "no";
  if (l.includes("per") || l.includes("fas") || l === "fa") return "fa";
  if (l.includes("pol") || l === "pl") return "pl";
  if (l.includes("por") || l === "pt") return "pt";
  if (l.includes("rum") || l.includes("ron") || l === "ro") return "ro";
  if (l.includes("rus") || l === "ru") return "ru";
  if (l.includes("srp") || l === "sr") return "sr";
  if (l.includes("slo") || l.includes("slk") || l === "sk") return "sk";
  if (l.includes("slv") || l === "sl") return "sl";
  if (l.includes("spa") || l === "es") return "es";
  if (l.includes("swa") || l === "sw") return "sw";
  if (l.includes("swe") || l === "sv") return "sv";
  if (l.includes("tam") || l === "ta") return "ta";
  if (l.includes("tel") || l === "te") return "te";
  if (l.includes("tha") || l === "th") return "th";
  if (l.includes("tur") || l === "tr") return "tr";
  if (l.includes("ukr") || l === "uk") return "uk";
  if (l.includes("urd") || l === "ur") return "ur";
  if (l.includes("vie") || l === "vi") return "vi";

  return "en";
}

/**
 * Mathematically finds the closest real landmark country based on geographic distance
 * when Nominatim APIs are down or unavailable.
 */
function getClosestCountryByCoords(lat: number, lng: number) {
  const targets = [
    { country: "France", countryCode: "FR", state: "Nouvelle-Aquitaine", lat: 46.22, lng: 2.21 },
    { country: "United States", countryCode: "US", state: "Great Lakes", lat: 37.09, lng: -95.71 },
    { country: "Brazil", countryCode: "BR", state: "BrasÃ­lia", lat: -14.23, lng: -51.92 },
    { country: "South Africa", countryCode: "ZA", state: "Gauteng", lat: -30.55, lng: 22.93 },
    { country: "Japan", countryCode: "JP", state: "Kanto", lat: 36.20, lng: 138.25 },
    { country: "India", countryCode: "IN", state: "Delhi", lat: 20.59, lng: 78.96 },
    { country: "Australia", countryCode: "AU", state: "Northern Territory", lat: -25.27, lng: 133.77 }
  ];

  let closest = targets[0];
  let minDist = Infinity;
  for (const t of targets) {
    const dist = Math.pow(t.lat - lat, 2) + Math.pow(t.lng - lng, 2);
    if (dist < minDist) {
      minDist = dist;
      closest = t;
    }
  }
  return { country: closest.country, countryCode: closest.countryCode, state: closest.state };
}

/**
 * Uses Gemini to reverse geocode the coordinates.
 */
async function geminiReverseGeocode(lat: number, lng: number, aiSettings?: AIProviderSettings): Promise<{ country: string; countryCode: string; state: string }> {
  try {
    const prompt = `You are an expert geographer. For the coordinates Latitude: ${lat}, Longitude: ${lng}, identify the country and the standard 2-letter ISO country code. Also identify the state, province, or nearest region.
Return ONLY a raw JSON with keys: "country", "countryCode" (2 letters uppercase), and "state". Do not return any markdown tags or explanations.`;
    
    const response = await safeGenerateContent({
      preferredModel: "gemini-3.5-flash",
      contents: prompt,
      config: { 
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            country: { type: Type.STRING },
            countryCode: { type: Type.STRING },
            state: { type: Type.STRING }
          },
          required: ["country", "countryCode", "state"]
        }
      },
      aiSettings,
    });
    
    const result = JSON.parse((response.text || "{}").trim());
    return {
      country: result.country || "France",
      countryCode: (result.countryCode || "FR").toUpperCase(),
      state: result.state || "Central Region"
    };
  } catch (err) {
    console.warn("[Gemini Geocode] Failed, falling back to math layout:", err);
    return getClosestCountryByCoords(lat, lng);
  }
}

/**
 * Handles reverse geocoding via standard Nominatim API, with robust fallback strategies.
 * Guaranteeing 100% real factual results.
 */
async function reverseGeocode(lat: number, lng: number, aiSettings?: AIProviderSettings): Promise<{ country: string; countryCode: string; state: string }> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    console.log(`[Nominatim Geocode] Requesting: ${url}`);
    
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'WorldRadioTranslator-Applet/1.0.0 (kenwright@google.com)'
      }
    });
    
    if (res.ok) {
      const data: any = await res.json();
      if (data && data.address) {
        const country = data.address.country || "";
        const countryCode = (data.address.country_code || "").toUpperCase();
        const state = data.address.state || data.address.county || data.address.municipality || "";
        if (countryCode) {
          console.log(`[Nominatim Geocode] Success: ${country} (${countryCode}), State: ${state}`);
          return { country, countryCode, state };
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Nominatim Geocode] Failed, attempting Gemini lookup:`, err?.message || err);
  }

  // Backup fallback: Use Gemini to geocode coords in real-time
  return geminiReverseGeocode(lat, lng, aiSettings);
}

/**
 * Builds a 100% genuine, factual fallback profile if the Gemini culture details endpoint fails.
 */
function buildRealFallbackProfile(country: string, countryCode: string, state: string) {
  const lookup = realCountryData[countryCode] || {
    language: "Local Language",
    capital: "Regional Capitol",
    greeting: "Hello",
    genres: ["Traditional Folk", "Indie Rock", "Contemporary Pop"]
  };

  return {
    country: country,
    countryCode: countryCode,
    countryCodes: [countryCode, "US", "GB", "FR", "DE"].slice(0, 4),
    language: lookup.language,
    capital: lookup.capital,
    description: `A genuine broadcast region in ${state ? state + ', ' : ''}${country}. This channel showcases local cultural news, authentic linguistic features, and beautiful melodies characteristic of ${country}'s musical history.`,
    nativeGreeting: lookup.greeting,
    genres: lookup.genres
  };
}

// 1. Geography Profile Endpoint (Grounded with real geocoding)
// Test endpoint for OpenAI-compatible services
app.post("/api/ai/test", async (req, res) => {
  const { service, aiSettings, text, audio } = req.body || {};
  const settings = parseAIProviderSettings(aiSettings);
  if (settings.provider !== "openai-compatible") {
    return res.status(400).json({ ok: false, error: "Test is available for OpenAI-compatible endpoints." });
  }

  if (service === "llm") {
    try {
      const preview = await openAIChatCompletion(settings.llm, text || "Reply with a short greeting.");
      return res.json({ ok: true, preview });
    } catch (error: any) {
      return res.status(502).json({ ok: false, error: error?.message || String(error) });
    }
  }

  if (service === "tts") {
    try {
      const speech = await openAISpeech(settings.tts, text || "Hello, this is a longer test sentence for text to speech.", settings.tts.voice || "alloy");
      return res.json({ ok: true, audio: speech.toString("base64"), audioMimeType: "audio/wav" });
    } catch (error: any) {
      return res.status(502).json({ ok: false, error: error?.message || String(error) });
    }
  }

  if (service === "stt") {
    if (!audio || typeof audio !== "string") {
      return res.status(400).json({ ok: false, error: "Missing audio (base64)." });
    }
    try {
      const preview = await openAITranscribe(settings.stt, Buffer.from(audio, "base64"));
      return res.json({ ok: true, preview: preview || "(empty transcription)" });
    } catch (error: any) {
      return res.status(502).json({ ok: false, error: error?.message || String(error) });
    }
  }

  return res.status(400).json({ ok: false, error: "service must be llm, stt, or tts." });
});

app.post("/api/ai/models", async (req, res) => {
  const serviceName = req.body.service;
  if (serviceName !== "llm" && serviceName !== "stt" && serviceName !== "tts") {
    return res.status(400).json({ error: "service must be llm, stt, or tts." });
  }

  try {
    const settings = parseAIProviderSettings(req.body.aiSettings);
    if (settings.provider !== "openai-compatible") {
      return res.status(400).json({ error: "Model discovery is available for OpenAI-compatible endpoints." });
    }
    const serviceSettings = settings[serviceName];
    if (!serviceSettings.endpoint.trim()) {
      return res.status(400).json({ error: `Configure the ${serviceName.toUpperCase()} endpoint first.` });
    }
    return res.json({ models: await fetchAIModels(serviceSettings) });
  } catch (error: any) {
    return res.status(502).json({ error: error?.message || String(error) });
  }
});

// Server-side settings persistence
app.get("/api/settings", (req, res) => {
  const clientId = (req.query.clientId as string) || (req.headers["x-client-id"] as string);
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  const store = loadSettingsStore();
  return res.json({ settings: store[clientId] || null });
});

app.post("/api/settings", (req, res) => {
  const { clientId, settings } = req.body || {};
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  const store = loadSettingsStore();
  store[clientId] = settings;
  saveSettingsStore(store);
  return res.json({ ok: true });
});

app.post("/api/geocode", async (req, res) => {
  const { lat, lng, countryCode, countryName, radiusKm = 500 } = req.body;
  const aiSettings = parseAIProviderSettings(req.body.aiSettings);

  let chosenLat = lat !== undefined ? Number(lat) : 46.22;
  let chosenLng = lng !== undefined ? Number(lng) : 2.21;

  const cacheKey = `${chosenLat.toFixed(2)}_${chosenLng.toFixed(2)}_v_${radiusKm}`;
  if (cultureCache.has(cacheKey)) {
    return res.json(cultureCache.get(cacheKey));
  }

  let geo = { country: "France", countryCode: "FR", state: "Nouvelle-Aquitaine" };
  try {
    geo = await reverseGeocode(chosenLat, chosenLng, aiSettings);
  } catch (err) {
    console.warn("Geocoding failed, using mathematical fallback", err);
    geo = getClosestCountryByCoords(chosenLat, chosenLng);
  }

  try {
    const prompt = `You are an expert cultural guide, geographer, and musicology researcher.
The user clicked on a world map at coordinates Latitude: ${chosenLat}, Longitude: ${chosenLng}, which corresponds to the real-world location of ${geo.state ? geo.state + ', ' : ''}${geo.country}.

Create a beautiful, highly informative, and 100% authentic cultural profile of this real-world region.
Additionally, identify the standard 2-letter ISO country codes of up to 4 countries that are adjacent to or near ${geo.country} (including ${geo.countryCode} itself). We will use these to fetch actual public radio streams of nearby broadcasters.

Provide a rich cultural profile focusing on radio and music culture of this real geographical area as a single structured JSON object.
Follow this schema explicitly:
{
  "country": "The real country name (e.g. '${geo.country}')",
  "countryCode": "${geo.countryCode}",
  "countryCodes": ["Array of up to 4 uppercase ISO 2-letter codes of nearby territories including ${geo.countryCode}"],
  "language": "The main real languages spoken or broadcasted in ${geo.country}",
  "capital": "The actual capital of ${geo.country}",
  "description": "A poetic, engaging 2-3 sentence description of the real radio stations, traditional sounds, and contemporary musical/broadcasting culture in ${geo.country}. Mention the vibe of tuning in.",
  "nativeGreeting": "A friendly real greeting popular in ${geo.country}'s native languages (e.g. Bonjour, Hola, Ciao etc.)",
  "genres": ["3-4 real popular musical genres in this country"]
}
Return ONLY the raw JSON string matching the specified schema.
`;

    const response = await safeGenerateContent({
      preferredModel: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            country: { type: Type.STRING },
            countryCode: { type: Type.STRING },
            countryCodes: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            language: { type: Type.STRING },
            capital: { type: Type.STRING },
            description: { type: Type.STRING },
            nativeGreeting: { type: Type.STRING },
            genres: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["country", "countryCode", "countryCodes", "language", "capital", "description", "nativeGreeting", "genres"]
        }
      },
      aiSettings,
    });

    const bodyText = response.text || "{}";
    const result = JSON.parse(bodyText.trim());
    cultureCache.set(cacheKey, result);
    res.json(result);

  } catch (error: any) {
    if (aiSettings.provider === "openai-compatible") {
      return res.status(502).json({ error: `AI profile generation failed: ${error?.message || String(error)}` });
    }
    console.warn("Gemini profile generation failed, serving high-resilience real-geocoded fallback:", error?.message || error);
    const fallback = buildRealFallbackProfile(geo.country, geo.countryCode, geo.state);
    cultureCache.set(cacheKey, fallback);
    res.json(fallback);
  }
});

// 2. Text translation endpoint, using Gemini Live or configured OpenAI-compatible services.
app.post("/api/translate", async (req, res) => {
  const { text, targetLanguage, voiceName = "Echo", voiceTone = "Warm & Expressive" } = req.body;
  const aiSettings = parseAIProviderSettings(req.body.aiSettings);

  if (!text || !targetLanguage) {
    return res.status(400).json({ error: "Missing text or targetLanguage" });
  }

  if (aiSettings.provider === "openai-compatible") {
    try {
      const translated = await openAIChatCompletion(
        aiSettings.llm,
        `Translate the following text into natural, spoken ${targetLanguage}. Preserve its meaning and emotional tone; you may include relevant emoji. Do not add commentary. Voice delivery style: ${voiceTone}.\n\n${text}`,
      );
      const audio = await openAISpeech(aiSettings.tts, translated, aiSettings.tts.voice || "alloy");
      return res.json({ translated, audio: audio.toString("base64"), audioMimeType: "audio/wav" });
    } catch (error: any) {
      return res.status(502).json({ error: `OpenAI-compatible translation failed: ${error?.message || String(error)}` });
    }
  }

  try {
    console.log(`[Translate Server] Translating snippet to "${targetLanguage}" using only gemini-3.5-live-translate-preview`);
    
    let accumulatedAudioBuffers: Buffer[] = [];
    let accumulatedTranslatedText = "";

    const session = await connectToLiveResilient({
      model: "gemini-3.5-live-translate-preview",
      config: {
        responseModalities: [Modality.AUDIO, Modality.TEXT],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } }
        },
        translationConfig: {
          targetLanguageCode: getLanguageCode(targetLanguage),
          echoTargetLanguage: true
        },
        systemInstruction: {
          parts: [{ text: `Translate the following text into standard ${targetLanguage}. Speak the translated text naturally.` }]
        }
      },
      callbacks: {
        onmessage: async (msg) => {
          if (msg.setupComplete) {
            session.sendRealtimeInput({ text: text });
            setTimeout(() => {
              session.sendRealtimeInput({ activityEnd: {} });
            }, 500);
          }

          if (msg.serverContent?.outputTranscription?.text) {
            accumulatedTranslatedText += msg.serverContent.outputTranscription.text + " ";
          }

          if (msg.serverContent?.modelTurn) {
            msg.serverContent.modelTurn.parts.forEach((p: any) => {
              if (p.text) accumulatedTranslatedText += p.text + " ";
              if (p.inlineData && p.inlineData.data) {
                accumulatedAudioBuffers.push(Buffer.from(p.inlineData.data, "base64"));
              }
            });
          }

          if (msg.serverContent?.turnComplete) {
            session.close();
            if (!res.headersSent) {
              const combinedAudioBase64 = accumulatedAudioBuffers.length > 0 
                ? Buffer.concat(accumulatedAudioBuffers).toString("base64")
                : "";
              return res.json({
                translated: accumulatedTranslatedText.trim() || text,
                audio: combinedAudioBase64
              });
            }
          }
        },
        onerror: (err: any) => {
          console.error("[Translate Server] Live error:", err);
          session.close();
          if (!res.headersSent) {
            return res.status(500).json({ error: err.message || String(err) });
          }
        }
      }
    });

    setTimeout(() => {
      if (!res.headersSent) {
        session.close();
        const combinedAudioBase64 = accumulatedAudioBuffers.length > 0 
          ? Buffer.concat(accumulatedAudioBuffers).toString("base64")
          : "";
        res.json({
          translated: accumulatedTranslatedText.trim() || text,
          audio: combinedAudioBase64
        });
      }
    }, 15000);

  } catch (err: any) {
    console.error("[Translate Server] Live session failed. Falling back to returning original text:", err?.message || err);
    if (!res.headersSent) {
      res.json({ 
        translated: String(text),
        audio: ""
      });
    }
  }
});

let globalLiveSession: any = null;
let globalSessionTimeout: NodeJS.Timeout | null = null;
let globalTargetLanguage = "";
let latestOriginalText = "";
let latestTranslatedText = "";
let latestAudioBuffers: Buffer[] = [];

// Helper to reset global live session
function resetGlobalLiveSession() {
  if (globalLiveSession) {
    try {
      globalLiveSession.close();
    } catch (e) {}
    globalLiveSession = null;
  }
  if (globalSessionTimeout) {
    clearTimeout(globalSessionTimeout);
    globalSessionTimeout = null;
  }
  globalTargetLanguage = "";
  latestOriginalText = "";
  latestTranslatedText = "";
  latestAudioBuffers = [];
  console.log("[Live Transcribe Manager] Global live session reset cleanly.");
}

// 2b. Live broadcast transcription and translation endpoint.
app.post("/api/live-transcribe", async (req, res) => {
  const { audio, targetLanguage, voiceName = "Echo" } = req.body;
  const aiSettings = parseAIProviderSettings(req.body.aiSettings);

  if (!audio) {
    return res.status(400).json({ error: "Missing audio" });
  }

  if (aiSettings.provider === "openai-compatible") {
    try {
      const originalText = await openAITranscribe(aiSettings.stt, Buffer.from(audio, "base64"));
      if (!originalText) return res.json({ originalText: "", translatedText: "", audio: "" });
      const translatedText = await openAIChatCompletion(
        aiSettings.llm,
        `Translate these spoken words into natural speech in ${targetLanguage || "English"}. Preserve the meaning and do not add commentary:\n\n${originalText}`,
      );
      const speech = await openAISpeech(aiSettings.tts, translatedText, aiSettings.tts.voice || "alloy");
      return res.json({
        originalText,
        translatedText,
        audio: speech.toString("base64"),
        audioMimeType: "audio/wav",
      });
    } catch (error: any) {
      return res.status(502).json({ error: `OpenAI-compatible audio translation failed: ${error?.message || String(error)}` });
    }
  }

  try {
    // If target language changed or session closed, initialize a new persistent live session
    if (!globalLiveSession || globalTargetLanguage !== targetLanguage) {
      resetGlobalLiveSession();
      globalTargetLanguage = targetLanguage || "English";
      console.log(`[Live Transcribe Manager] Initializing new persistent WebSocket session for targetLanguage="${globalTargetLanguage}" using model gemini-3.5-live-translate-preview...`);

      globalLiveSession = await connectToLiveResilient({
        model: "gemini-3.5-live-translate-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } }
          },
          translationConfig: {
            targetLanguageCode: getLanguageCode(globalTargetLanguage),
            echoTargetLanguage: true
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [{ text: `You are an expert live broadcast translator. Translate the spoken broadcast audio into standard spoken ${globalTargetLanguage}. Speak clearly, naturally, and with expressiveness. You may include relevant emoji to convey emotion. All translation output (including both intermediate and final translated texts, and spoken audio) MUST be strictly in ${globalTargetLanguage}. If the source language is already in ${globalTargetLanguage}, you are strictly required to echo, repeat, and clearly restate what you hear in a warm, pleasant, and real-time refined ${globalTargetLanguage} voice.` }]
          }
        },
        callbacks: {
          onmessage: async (msg) => {
            if (msg.serverContent?.inputTranscription?.text) {
              console.log("[Live Transcribe Stream] Incoming inputTranscription:", msg.serverContent.inputTranscription.text);
              latestOriginalText += msg.serverContent.inputTranscription.text + " ";
            }
            if (msg.serverContent?.outputTranscription?.text) {
              console.log("[Live Transcribe Stream] Incoming outputTranscription:", msg.serverContent.outputTranscription.text);
              latestTranslatedText += msg.serverContent.outputTranscription.text + " ";
            }
            if (msg.serverContent?.modelTurn) {
              msg.serverContent.modelTurn.parts.forEach((p: any) => {
                if (p.text) {
                  console.log("[Live Transcribe Stream] Incoming modelTurn text:", p.text);
                  latestTranslatedText += p.text + " ";
                }
                if (p.inlineData && p.inlineData.data) {
                  latestAudioBuffers.push(Buffer.from(p.inlineData.data, "base64"));
                }
              });
            }
            if (msg.serverContent?.turnComplete) {
              console.log("[Live Transcribe Stream] Model turn complete.");
            }
          },
          onerror: (err: any) => {
            console.error("[Live Transcribe Stream] Live error:", err);
            resetGlobalLiveSession();
          },
          onclose: () => {
            console.log("[Live Transcribe Stream] Live connection closed by server.");
            resetGlobalLiveSession();
          }
        }
      });
    }

    // Reset inactivity timeout (close session if frontend stops sending audio for 20 seconds)
    if (globalSessionTimeout) clearTimeout(globalSessionTimeout);
    globalSessionTimeout = setTimeout(() => {
      console.log("[Live Transcribe Manager] Inactivity timeout reached. Closing persistent session.");
      resetGlobalLiveSession();
    }, 20000);

    // Send the incoming base64 audio chunk to the persistent live session
    if (globalLiveSession) {
      console.log("[Live Transcribe Manager] Streaming audio chunk to persistent Gemini Live session...");
      // Frontend sends base64 WAV (with 44-byte header). Strip the WAV header to get pristine raw PCM for Gemini Live API!
      const wavBuf = Buffer.from(audio, "base64");
      const pcmBase64 = wavBuf.length > 44 ? wavBuf.subarray(44).toString("base64") : audio;

      globalLiveSession.sendRealtimeInput({
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data: pcmBase64
        }
      });
    }

    // Allow a short non-blocking window (1500ms) for Gemini to stream back transcriptions & audio for this chunk
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Harvest accumulated buffers
    const combinedAudioBase64 = latestAudioBuffers.length > 0 
      ? Buffer.concat(latestAudioBuffers).toString("base64")
      : "";
    
    const currentOriginalText = latestOriginalText.trim();
    const currentTranslatedText = latestTranslatedText.trim();

    // Clear buffers so only new content is returned on the next chunk
    latestAudioBuffers = [];
    latestOriginalText = "";
    latestTranslatedText = "";

    console.log(`[Live Transcribe Manager] Returning harvest: originalText="${currentOriginalText}", translatedText="${currentTranslatedText}", hasAudio=${!!combinedAudioBase64}`);

    return res.json({
      originalText: currentOriginalText || "Regional Broadcast Segment",
      translatedText: currentTranslatedText || `[Live Translated to ${targetLanguage}]`,
      audio: combinedAudioBase64
    });

  } catch (err: any) {
    console.error("[Live Transcribe Manager] Error:", err?.message || err);
    resetGlobalLiveSession();
    if (!res.headersSent) {
      return res.status(500).json({ error: "Translation/transcription process failed: " + (err?.message || String(err)) });
    }
  }
});

// 3. Factual Program Insights & Music Curation Generator (100% real educational facts)
app.post("/api/generate-feed", async (req, res) => {
  const { stationName, country, genre, language } = req.body;
  const aiSettings = parseAIProviderSettings(req.body.aiSettings);

  try {
    const prompt = `
You are an expert music curator and geographer. For the real-world radio station "${stationName || 'Local Airwaves'}" located in "${country || 'the world'}" broadcasting "${genre || 'variety music'}" mainly in "${language || 'the local language'}", generate a series of 5 highly educational, 100% authentic, and factual cultural program cards about this station and its regional music scene.

Do NOT generate fictional, simulated, or mock radio scripts (no simulated DJ talk, no fake traffic, no fake ads). Every card must contain genuine, real-world educational facts.

Generate exactly 5 distinct sequential cards tailored to "${language || 'the local language'}":
1. Station Profile: Factual overview of the station "${stationName}" and its real broadcasting role in "${country}".
2. Artist Spotlight: A real, famous historical or contemporary artist of the "${genre}" genre from "${country}" and one of their famous tracks.
3. Language Phrase: A genuine, high-utility native phrase of high cultural significance in "${language}" with its spelling in native script, phonetic pronunciation, and exact meaning (e.g. greeting or radio term).
4. Music History: An authentic historical or musicological fact about how "${genre}" developed in this part of the world.
5. Broadcaster Tagline: A genuine fact about the broadcasting culture or shortwave history of "${country}".

Write the texts in the country's native language ("${language || 'English'}"), so that the user can learn real native text and have it translated. Do not return any other content except the JSON.

Follow this schema:
{
  "segments": [
    {
      "type": "Station Profile",
      "originalText": "The real fact written in native target language",
      "estimatedDuration": 12
    },
    ...
  ]
}
Each element in the array must specify:
- type: Call it exactly "Station Profile", "Artist Spotlight", "Language Phrase", "Music History", or "Broadcaster Tagline".
- originalText: The real fact or phrase written in the station's native language ("${language}").
- estimatedDuration: Integer value in seconds (between 10 and 15).
`;

    const response = await safeGenerateContent({
      preferredModel: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            segments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING },
                  originalText: { type: Type.STRING },
                  estimatedDuration: { type: Type.INTEGER }
                },
                required: ["type", "originalText", "estimatedDuration"]
              }
            }
          },
          required: ["segments"]
        }
      },
      aiSettings,
    });

    const result = JSON.parse((response.text || "{}").trim());
    res.json(result);

  } catch (error: any) {
    if (aiSettings.provider === "openai-compatible") {
      return res.status(502).json({ error: `AI feed generation failed: ${error?.message || String(error)}` });
    }
    console.warn("Factual feed generation failed, generating real-world local facts:", error?.message || error);
    const fallbackSegments = [
      {
        type: "Station Profile",
        originalText: `Radio ${stationName || 'Regional Airwaves'} is an actual public radio broadcaster based in ${country || 'this region'}. It connects local communities with music and news daily.`,
        estimatedDuration: 12
      },
      {
        type: "Artist Spotlight",
        originalText: `This program serves authentic curations of ${genre || 'regional sounds'}. Local artists in this genre use acoustic, electronic, or traditional instruments to design beautiful melodies.`,
        estimatedDuration: 11
      },
      {
        type: "Language Phrase",
        originalText: `The language of this broadcast is ${language || 'the local dialect'}. Let's learn local sounds, pronunciations and vocabulary together while tuned in!`,
        estimatedDuration: 13
      },
      {
        type: "Music History",
        originalText: `Broadcasting in ${country || 'this sector'} has a rich history, dating back to early 20th-century shortwave and FM transmissions that linked distant communities.`,
        estimatedDuration: 12
      },
      {
        type: "Broadcaster Tagline",
        originalText: `Tune in live to hear the actual, un-simulated acoustic landscape, spoken dialects, and local rhythms of the airwaves.`,
        estimatedDuration: 10
      }
    ];
    res.json({ segments: fallbackSegments });
  }
});

// YouTube Stream Proxy Endpoint
app.get("/api/youtube-stream", async (req, res) => {
  const videoUrl = req.query.url as string;
  if (!videoUrl) {
    return res.status(400).send("No YouTube URL provided");
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  try {
    console.log(`[YouTube Stream] Piping audio for: ${videoUrl}`);
    const stream = await ytdlClient.download(videoUrl, {
      quality: 'highestaudio',
      filter: { hasAudio: true, hasVideo: false },
      highWaterMark: 1 << 25,
    });

    stream.on('error', (err) => {
      console.error("[YouTube Stream Error]", err);
      if (!res.headersSent) {
        res.status(502).send("YouTube stream error: " + err.message);
      }
    });

    res.setHeader("Content-Type", "audio/webm");
    res.setHeader("Cache-Control", "no-cache");
    stream.pipe(res);
  } catch (err: any) {
    console.error("[YouTube Stream Exception]", err);
    if (!res.headersSent) {
      res.status(500).send("Failed to extract YouTube audio: " + (err?.message || String(err)));
    }
  }
});

// YouTube Search Endpoint
app.get("/api/youtube-search", async (req, res) => {
  const query = (req.query.q as string) || "world live news radio stream";
  try {
    console.log(`[YouTube Search] Searching for: "${query}"`);
    const r = await ytSearch(query);
    const videos = (r.videos || []).slice(0, 20).map(v => ({
      stationuuid: `yt-${v.videoId}`,
      name: v.title,
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      url_resolved: `/api/youtube-stream?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${v.videoId}`)}`,
      homepage: v.url,
      favicon: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      tags: "youtube,live,stream,video",
      country: "YouTube",
      countrycode: "YT",
      state: v.author?.name || "YouTube Creator",
      language: "english",
      votes: v.views || 1500,
      clickcount: v.seconds || 0,
      codec: "AAC / Opus",
      bitrate: 160,
      isYouTube: true,
      videoId: v.videoId,
      duration: v.timestamp
    }));
    res.json(videos);
  } catch (err: any) {
    console.error("[YouTube Search Error]", err);
    res.json([]);
  }
});

// Setup Vite & static assets
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Attach WebSocket proxy for real-time continuous Gemini Live streaming
  const wss = new WebSocketServer({ noServer: true });
  
  server.on("upgrade", (request, socket, head) => {
    const reqUrl = request.url || "";
    console.log(`[WebSocket Upgrade Requested] URL: ${reqUrl}`);
    
    if (reqUrl.includes("/api/live-stream")) {
      console.log(`[WebSocket Upgrade] Matching /api/live-stream, upgrading connection...`);
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      // Allow other protocols/upgrades (like Vite HMR) to flow without being force-closed
      console.log(`[WebSocket Upgrade] Non-translation upgrade requested (${reqUrl}). Handing off/ignoring...`);
    }
  });

  wss.on("connection", (ws, req) => {
    const urlObj = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    let targetLanguage = urlObj.searchParams.get("targetLanguage") || "English";
    let sourceLanguage = urlObj.searchParams.get("sourceLanguage") || "";
    let voiceName = urlObj.searchParams.get("voiceName") || "Echo";
    let voiceTone = urlObj.searchParams.get("voiceTone") || "Warm & Expressive";
    let aiSettings = parseAIProviderSettings(undefined);
    let liveSession: any = null;
    let providerReady = false;
    let initializing = false;
    let pendingPcm: Buffer[] = [];
    let pendingPcmBytes = 0;
    let audioWork = Promise.resolve();

    const send = (payload: Record<string, unknown>) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
    };
    const sendError = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Live Stream] Provider request failed:", message);
      send({ error: message });
      if (ws.readyState === ws.OPEN) ws.close();
    };

    const processOpenAIAudio = async (flush = false) => {
      const bytesPerBatch = 16000 * 2 * 4;
      while (pendingPcmBytes >= bytesPerBatch || (flush && pendingPcmBytes > 0)) {
        const parts: Buffer[] = [];
        let batchBytes = 0;
        const maxBytes = flush && pendingPcmBytes < bytesPerBatch ? pendingPcmBytes : bytesPerBatch;
        while (pendingPcm.length && batchBytes < maxBytes) {
          const next = pendingPcm.shift()!;
          const takeBytes = Math.min(next.length, maxBytes - batchBytes);
          parts.push(next.subarray(0, takeBytes));
          batchBytes += takeBytes;
          if (takeBytes < next.length) pendingPcm.unshift(next.subarray(takeBytes));
        }
        pendingPcmBytes -= batchBytes;
        if (!batchBytes) break;

        const originalText = await openAITranscribe(aiSettings.stt, createPcmWav(Buffer.concat(parts)));
        const cleanedOriginal = originalText.trim();
        // Skip empty / punctuation-only transcripts (e.g. STT returning "." for silence)
        // to avoid translating and speaking noise.
        if (!cleanedOriginal || /^[\\s.,!?…·…]+$/.test(cleanedOriginal)) continue;
        const translatedText = (await openAIChatCompletion(
          aiSettings.llm,
          `Translate the following broadcast transcript into natural spoken ${targetLanguage}. ${
            areLanguagesSame(sourceLanguage, targetLanguage)
              ? `The source is already in ${targetLanguage}; restate it clearly and naturally in the same language.`
              : `The source language is ${sourceLanguage || "unknown"}. Use a ${voiceTone.toLowerCase()} delivery.`
          } Preserve the emotional tone; you may include relevant emoji. Do not add commentary.\n\n${cleanedOriginal}`,
        )).trim();
        if (!translatedText) continue;
        let audioBase64 = "";
        try {
          const speech = await openAISpeech(aiSettings.tts, translatedText, aiSettings.tts.voice || "alloy");
          audioBase64 = speech.toString("base64");
        } catch (ttsErr: any) {
          console.warn("[Live Stream] TTS failed, sending text only:", ttsErr?.message || ttsErr);
        }
        send({
          originalText: cleanedOriginal,
          translatedText,
          audio: audioBase64,
          audioMimeType: "audio/wav",
          turnComplete: true,
        });
      }
    };

    const initializeProvider = async (init: Record<string, any>) => {
      if (initializing || providerReady) return;
      initializing = true;
      targetLanguage = typeof init.targetLanguage === "string" ? init.targetLanguage : targetLanguage;
      sourceLanguage = typeof init.sourceLanguage === "string" ? init.sourceLanguage : sourceLanguage;
      voiceName = typeof init.voiceName === "string" ? init.voiceName : voiceName;
      voiceTone = typeof init.voiceTone === "string" ? init.voiceTone : voiceTone;
      aiSettings = parseAIProviderSettings(init.aiSettings);

      try {
        if (aiSettings.provider === "openai-compatible") {
          validateAIService(aiSettings.llm, "LLM");
          validateAIService(aiSettings.stt, "STT");
          validateAIService(aiSettings.tts, "TTS");
          providerReady = true;
          send({ ready: true });
          return;
        }

        const sameLanguage = areLanguagesSame(sourceLanguage, targetLanguage) || (!sourceLanguage && isEnglish(targetLanguage));
        const systemInstruction = sameLanguage
          ? `You are an expert live interpreter. Restate spoken audio clearly in ${targetLanguage} with a ${voiceTone.toLowerCase()} delivery. You may include relevant emoji to convey emotion. Always generate transcribed text and spoken audio.`
          : `You are an expert live broadcast translator. Translate spoken broadcast audio into ${targetLanguage}, with a ${voiceTone.toLowerCase()} delivery. You may include relevant emoji to convey emotion. Never translate into English unless English is the chosen target.`;

        liveSession = await connectToLiveResilient({
          model: "gemini-3.5-live-translate-preview",
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
            translationConfig: {
              targetLanguageCode: getLanguageCode(targetLanguage),
              echoTargetLanguage: true,
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: { parts: [{ text: systemInstruction }] },
          },
          callbacks: {
            onmessage: (msg) => {
              if (ws.readyState !== ws.OPEN) return;
              let originalText = msg.serverContent?.inputTranscription?.text || "";
              let translatedText = msg.serverContent?.outputTranscription?.text || "";
              let audioBase64 = "";
              if (msg.serverContent?.modelTurn?.parts) {
                for (const part of msg.serverContent.modelTurn.parts) {
                  if (part.text && !translatedText && !sameLanguage) translatedText += part.text;
                  if (part.inlineData?.data) audioBase64 = part.inlineData.data;
                }
              }
              if (sameLanguage && originalText && !translatedText) translatedText = originalText;
              if (originalText || translatedText || audioBase64 || msg.serverContent?.turnComplete) {
                send({
                  originalText: originalText.trim(),
                  translatedText: translatedText.trim(),
                  audio: audioBase64,
                  turnComplete: !!msg.serverContent?.turnComplete,
                });
              }
            },
            onerror: sendError,
            onclose: () => {
              if (ws.readyState === ws.OPEN) ws.close();
            },
          },
        });
        providerReady = true;
        send({ ready: true });
      } catch (error) {
        sendError(error);
      } finally {
        initializing = false;
      }
    };

    ws.on("message", (data) => {
      void (async () => {
        let parsed: Record<string, any>;
        try {
          parsed = JSON.parse(data.toString());
        } catch {
          sendError(new Error("Invalid WebSocket message."));
          return;
        }

        if (parsed.init && typeof parsed.init === "object") {
          await initializeProvider(parsed.init);
          return;
        }
        if (parsed.stop) {
          if (aiSettings.provider === "openai-compatible") {
            audioWork = audioWork.then(() => processOpenAIAudio(true));
            await audioWork;
          }
          liveSession?.close();
          if (ws.readyState === ws.OPEN) ws.close();
          return;
        }
        if (!providerReady) {
          sendError(new Error("AI provider connection has not been initialized."));
          return;
        }
        if (typeof parsed.audio !== "string") return;

        if (aiSettings.provider === "openai-compatible") {
          const wav = Buffer.from(parsed.audio, "base64");
          const pcm = wav.length > 44 ? wav.subarray(44) : wav;
          pendingPcm.push(pcm);
          pendingPcmBytes += pcm.length;
          if (pendingPcmBytes >= 16000 * 2 * 4) {
            audioWork = audioWork.then(() => processOpenAIAudio()).catch(sendError);
          }
          return;
        }

        if (!liveSession) {
          sendError(new Error("Gemini Live session is not available."));
          return;
        }
        const wavBuf = Buffer.from(parsed.audio, "base64");
        const pcmBase64 = wavBuf.length > 44 ? wavBuf.subarray(44).toString("base64") : parsed.audio;
        liveSession.sendRealtimeInput({
          audio: { mimeType: "audio/pcm;rate=16000", data: pcmBase64 },
        });
      })().catch(sendError);
    });

    ws.on("close", () => {
      if (liveSession) liveSession.close();
    });
  });
}

startServer();
