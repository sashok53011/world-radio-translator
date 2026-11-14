export interface LogEntry {
  time: number;
  category: string;
  message: string;
}

const MAX_ENTRIES = 500;
let entries: LogEntry[] = [];
let listeners: Array<(entries: LogEntry[]) => void> = [];

function notify() {
  const snapshot = [...entries];
  listeners.forEach((l) => l(snapshot));
}

export function log(category: string, message: string): void {
  const entry: LogEntry = { time: Date.now(), category, message };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  // Also print to console for server-side / dev visibility
  try {
    console.log(`[${category}] ${message}`);
  } catch {}
  notify();
}

export function getLogs(): LogEntry[] {
  return [...entries];
}

export function clearLogs(): void {
  entries = [];
  notify();
}

export function subscribeLogs(listener: (entries: LogEntry[]) => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}
