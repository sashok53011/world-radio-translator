/// <reference types="vite/client" />
// Base URL for the backend API. Empty in web dev (relative paths).
// Resolution order: localStorage override -> VITE_API_BASE_URL env -> "" (relative).
function resolveBase(): string {
  let raw = "";
  try {
    const stored = localStorage.getItem("world_radio_backend_url");
    if (stored && stored.trim()) raw = stored.trim();
  } catch {}
  if (!raw) raw = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "";
  // Default to the public Cloudflare tunnel when no explicit backend is configured
  if (!raw) raw = "https://world-radio-translator.devhorizon.online";
  return raw.replace(/\/+$/, "");
}

export function getApiBase(): string {
  return resolveBase();
}

export function getWsBase(): string {
  const base = resolveBase();
  if (base) return base.replace(/^http/, "ws");
  if (typeof window !== "undefined") {
    return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
  }
  return "";
}

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${resolveBase()}${p}`;
}

export function wsUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${getWsBase()}${p}`;
}