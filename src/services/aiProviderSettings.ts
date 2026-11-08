import { AIProviderSettings } from "../types";

const STORAGE_KEY = "world_radio_ai_provider_settings";

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
