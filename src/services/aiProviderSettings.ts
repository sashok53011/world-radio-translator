import { AIProviderSettings } from "../types";

const STORAGE_KEY = "world_radio_ai_provider_settings";
const CLIENT_ID_KEY = "world_radio_client_id";
const BACKEND_URL_KEY = "world_radio_backend_url";

export function getClientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = "c_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return "c_anon";
  }
}

export const DEFAULT_AI_PROVIDER_SETTINGS: AIProviderSettings = {
  provider: "gemini",
  llm: {
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKey: "",
    model: "gpt-4o-mini",
  },
  stt: {
    endpoint: "https://api.openai.com/v1/audio/transcriptions",
    apiKey: "",
    model: "whisper-1",
  },
  tts: {
    endpoint: "https://api.openai.com/v1/audio/speech",
    apiKey: "",
    model: "tts-1",
    voice: "alloy",
  },
};

export function loadAIProviderSettings(): AIProviderSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_AI_PROVIDER_SETTINGS;

    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return DEFAULT_AI_PROVIDER_SETTINGS;
    const settings = parsed as Partial<AIProviderSettings>;
    const service = (value: unknown, fallback: AIProviderSettings["llm"]) => {
      if (!value || typeof value !== "object") return fallback;
      const candidate = value as Partial<AIProviderSettings["llm"]>;
      return {
        endpoint: typeof candidate.endpoint === "string" ? candidate.endpoint : fallback.endpoint,
        ...(typeof candidate.modelsEndpoint === "string" ? { modelsEndpoint: candidate.modelsEndpoint } : {}),
        apiKey: typeof candidate.apiKey === "string" ? candidate.apiKey : "",
        model: typeof candidate.model === "string" ? candidate.model : fallback.model,
        ...(typeof candidate.voice === "string" ? { voice: candidate.voice } : {}),
      };
    };

    return {
      provider: settings.provider === "openai-compatible" ? "openai-compatible" : "gemini",
      llm: service(settings.llm, DEFAULT_AI_PROVIDER_SETTINGS.llm),
      stt: service(settings.stt, DEFAULT_AI_PROVIDER_SETTINGS.stt),
      tts: service(settings.tts, DEFAULT_AI_PROVIDER_SETTINGS.tts),
    };
  } catch (error) {
    console.error("Could not load AI provider settings:", error);
    return DEFAULT_AI_PROVIDER_SETTINGS;
  }
}

export function saveAIProviderSettings(settings: AIProviderSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export async function loadAIProviderSettingsFromServer(): Promise<AIProviderSettings | null> {
  try {
    const base = (localStorage.getItem(BACKEND_URL_KEY) || "").replace(/\/+$/, "");
    const clientId = getClientId();
    const res = await fetch(`${base}/api/settings?clientId=${encodeURIComponent(clientId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.settings && typeof data.settings === "object") {
      return data.settings as AIProviderSettings;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveAIProviderSettingsToServer(settings: AIProviderSettings): Promise<boolean> {
  try {
    const base = (localStorage.getItem(BACKEND_URL_KEY) || "").replace(/\/+$/, "");
    const clientId = getClientId();
    const res = await fetch(`${base}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, settings }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
