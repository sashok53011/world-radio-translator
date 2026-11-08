import { FormEvent, useState } from "react";
import { LoaderCircle, RefreshCw, X } from "lucide-react";
import { AIProviderSettings, AIServiceSettings } from "../types";
import { apiUrl } from "../apiBase";
import { useTranslation } from "react-i18next";

interface AIProviderSettingsPanelProps {
  settings: AIProviderSettings;
  onSave: (settings: AIProviderSettings) => void;
  onClose: () => void;
}

export default function AIProviderSettingsPanel({
  settings,
  onSave,
  onClose,
}: AIProviderSettingsPanelProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(settings);
  const [backendUrl, setBackendUrl] = useState<string>(() => {
    try { return localStorage.getItem("world_radio_backend_url") || ""; } catch { return ""; }
  });
  const [savedVoices, setSavedVoices] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("world_radio_tts_voices");
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      const voices = Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
      // Preserve the currently configured voice if present
      if (settings.tts.voice && !voices.includes(settings.tts.voice)) {
        voices.unshift(settings.tts.voice);
      }
      return voices;
    } catch {
      return settings.tts.voice ? [settings.tts.voice] : [];
    }
  });
  const [models, setModels] = useState<Record<"llm" | "stt" | "tts", string[]>>({ llm: [], stt: [], tts: [] });
  const [loadingModels, setLoadingModels] = useState<"llm" | "stt" | "tts" | null>(null);
  const [modelErrors, setModelErrors] = useState<Partial<Record<"llm" | "stt" | "tts", string>>>({});
  const [testText, setTestText] = useState<Record<"llm" | "tts", string>>({
    llm: "Say hello in one short sentence.",
    tts: "Hello, this is a longer test sentence for text to speech.",
  });
  const [sttFile, setSttFile] = useState<File | null>(null);
  const [testLoading, setTestLoading] = useState<"llm" | "stt" | "tts" | null>(null);
  const [testResults, setTestResults] = useState<Partial<Record<"llm" | "stt" | "tts", { ok: boolean; preview?: string; error?: string; audio?: string; audioMimeType?: string }>>>({});
  const updateService = (
    serviceName: "llm" | "stt" | "tts",
    field: keyof AIServiceSettings,
    value: string,
  ) => {
    setDraft({
      ...draft,
      [serviceName]: { ...draft[serviceName], [field]: value },
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try { localStorage.setItem("world_radio_backend_url", backendUrl.trim()); } catch {}
    // Persist any newly entered voice id
    const voice = draft.tts.voice?.trim();
    if (voice) {
      const updated = savedVoices.includes(voice) ? savedVoices : [voice, ...savedVoices];
      setSavedVoices(updated);
      try { localStorage.setItem("world_radio_tts_voices", JSON.stringify(updated)); } catch {}
    }
    onSave(draft);
    onClose();
  };

  const fetchModels = async (serviceName: "llm" | "stt" | "tts") => {
    setLoadingModels(serviceName);
    setModelErrors((current) => ({ ...current, [serviceName]: undefined }));
    try {
      const response = await fetch(apiUrl("/api/ai/models"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: serviceName, aiSettings: draft }),
      });
      const responseBody = await response.text();
      if (!responseBody.trim()) {
        throw new Error(`The server returned an empty response (${response.status}). Check that the app server is running and restart it if needed.`);
      }

      let result: { models?: string[]; error?: string };
      try {
        result = JSON.parse(responseBody) as { models?: string[]; error?: string };
      } catch {
        const preview = responseBody.replace(/\s+/g, " ").slice(0, 160);
        throw new Error(`The server returned a non-JSON response (${response.status}): ${preview}`);
      }
      if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
      if (!Array.isArray(result.models) || result.models.length === 0) {
        throw new Error("Endpoint returned no models.");
      }
      setModels((current) => ({ ...current, [serviceName]: result.models! }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setModelErrors((current) => ({ ...current, [serviceName]: message }));
    } finally {
      setLoadingModels(null);
    }
  };

  const runTest = async (service: "llm" | "stt" | "tts") => {
    setTestLoading(service);
    setTestResults((current) => ({ ...current, [service]: undefined }));
    try {
      let body: Record<string, unknown> = { service, aiSettings: draft };
      if (service === "llm") body.text = testText.llm;
      if (service === "tts") body.text = testText.tts;
      if (service === "stt") {
        if (!sttFile) {
          setTestResults((current) => ({ ...current, stt: { ok: false, error: "Select an audio file first." } }));
          setTestLoading(null);
          return;
        }
        const buf = await sttFile.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        const chunkSize = 16384;
        for (let i = 0; i < bytes.byteLength; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength)) as any);
        }
        body.audio = btoa(binary);
      }
      const response = await fetch(apiUrl("/api/ai/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      setTestResults((current) => ({ ...current, [service]: result }));
      if (service === "tts" && result?.ok && result.audio) {
        try {
          const audio = new Audio(`data:${result.audioMimeType || "audio/wav"};base64,${result.audio}`);
          void audio.play();
        } catch {}
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTestResults((current) => ({ ...current, [service]: { ok: false, error: message } }));
    } finally {
      setTestLoading(null);
    }
  };

  const inputClassName = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

  const renderService = (
    serviceName: "llm" | "stt" | "tts",
    title: string,
    description: string,
  ) => (
    <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <legend className="px-1 text-sm font-bold text-slate-800 dark:text-slate-100">{title}</legend>
      <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{t("settings.endpoint")}</span>
        <input
          className={inputClassName}
          type="url"
          value={draft[serviceName].endpoint}
          onChange={(event) => updateService(serviceName, "endpoint", event.target.value)}
          placeholder="https://example.com/v1/..."
          required={draft.provider === "openai-compatible"}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{t("settings.modelsUrl")}</span>
        <input
          className={inputClassName}
          type="url"
          value={draft[serviceName].modelsEndpoint || ""}
          onChange={(event) => updateService(serviceName, "modelsEndpoint", event.target.value)}
          placeholder="Leave blank to use the standard /models route"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{t("settings.model")}</span>
          <input
            className={inputClassName}
            list={`models-${serviceName}`}
            value={draft[serviceName].model}
            onChange={(event) => updateService(serviceName, "model", event.target.value)}
            placeholder="Model ID"
            required={draft.provider === "openai-compatible"}
          />
          <datalist id={`models-${serviceName}`}>
            {models[serviceName].map((model) => <option key={model} value={model} />)}
          </datalist>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{t("settings.apiKey")}</span>
          <input
            className={inputClassName}
            type="password"
            autoComplete="new-password"
            value={draft[serviceName].apiKey}
            onChange={(event) => updateService(serviceName, "apiKey", event.target.value)}
            placeholder="Optional for local endpoints"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void fetchModels(serviceName)}
          disabled={loadingModels !== null || !draft[serviceName].endpoint.trim()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {loadingModels === serviceName ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t("settings.fetchModels")}
        </button>
        {models[serviceName].length > 0 && (
          <span className="text-xs text-slate-500 dark:text-slate-400">{models[serviceName].length} models found</span>
        )}
        {modelErrors[serviceName] && (
          <span role="alert" className="text-xs text-rose-600 dark:text-rose-400">{modelErrors[serviceName]}</span>
        )}
      </div>

      {/* Test section */}
      <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-950/30">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Test endpoint</span>
          <button
            type="button"
            onClick={() => void runTest(serviceName)}
            disabled={testLoading !== null || !draft[serviceName].endpoint.trim() || !draft[serviceName].model.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testLoading === serviceName ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
            Test
          </button>
        </div>

        {serviceName === "llm" && (
          <textarea
            className={inputClassName}
            rows={2}
            value={testText.llm}
            onChange={(e) => setTestText((t) => ({ ...t, llm: e.target.value }))}
            placeholder="Test prompt"
          />
        )}
        {serviceName === "tts" && (
          <textarea
            className={inputClassName}
            rows={2}
            value={testText.tts}
            onChange={(e) => setTestText((t) => ({ ...t, tts: e.target.value }))}
            placeholder="Text to synthesize"
          />
        )}
        {serviceName === "stt" && (
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => setSttFile(e.target.files?.[0] || null)}
            className="w-full text-xs text-slate-600 dark:text-slate-300"
          />
        )}

        {testResults[serviceName] && (
          <div className={`rounded-lg p-2 text-xs ${testResults[serviceName]!.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/10 text-rose-700 dark:text-rose-400"}`}>
            {testResults[serviceName]!.ok ? (
              <>
                <span className="font-semibold">OK</span>
                {testResults[serviceName]!.preview ? <span className="ml-2">— {testResults[serviceName]!.preview}</span> : null}
                {serviceName === "tts" && testResults[serviceName]!.audio ? <span className="ml-2">(audio played)</span> : null}
              </>
            ) : (
              <span>{testResults[serviceName]!.error || "Failed"}</span>
            )}
          </div>
        )}
      </div>
      {serviceName === "tts" && (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{t("settings.voice")}</span>
            <input
              className={inputClassName}
              list="tts-voices-list"
              value={draft.tts.voice || ""}
              onChange={(event) => setDraft({
                ...draft,
                tts: { ...draft.tts, voice: event.target.value },
              })}
              placeholder="Voice ID (for example: alloy)"
            />
            <datalist id="tts-voices-list">
              {savedVoices.map((v) => <option key={v} value={v} />)}
            </datalist>
          </label>
          {savedVoices.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {savedVoices.map((v) => (
                <span
                  key={v}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, tts: { ...draft.tts, voice: v } })}
                    className="hover:text-emerald-600"
                    title="Use this voice"
                  >
                    {v}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const updated = savedVoices.filter((x) => x !== v);
                      setSavedVoices(updated);
                      try { localStorage.setItem("world_radio_tts_voices", JSON.stringify(updated)); } catch {}
                    }}
                    className="text-slate-400 hover:text-rose-500"
                    title="Remove"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </fieldset>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <header className="flex items-start justify-between border-b border-slate-200 p-5 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t("settings.title")}</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("settings.desc")}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close settings">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 overflow-y-auto p-5">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{t("settings.backendUrl")}</span>
            <input
              className={inputClassName}
              type="url"
              value={backendUrl}
              onChange={(event) => setBackendUrl(event.target.value)}
              placeholder="https://your-backend.example.com (leave empty for web)"
            />
            <span className="text-[10px] text-slate-400">{t("settings.backendHint")}</span>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{t("settings.provider")}</span>
            <select
              className={inputClassName}
              value={draft.provider}
              onChange={(event) => setDraft({
                ...draft,
                provider: event.target.value === "openai-compatible" ? "openai-compatible" : "gemini",
              })}
            >
              <option value="gemini">{t("settings.gemini")}</option>
              <option value="openai-compatible">{t("settings.openai")}</option>
            </select>
          </label>

          {draft.provider === "openai-compatible" && (
            <>
              {renderService("llm", t("settings.llmTitle"), t("settings.llmDesc"))}
              {renderService("stt", t("settings.sttTitle"), t("settings.sttDesc"))}
              {renderService("tts", t("settings.ttsTitle"), t("settings.ttsDesc"))}
              <p className="rounded-lg bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                {t("settings.warning")}
              </p>
            </>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">{t("settings.cancel")}</button>
          <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">{t("settings.save")}</button>
        </footer>
      </form>
    </div>
  );
}
