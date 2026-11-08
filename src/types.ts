export interface RadioStation {
  changeid: string;
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  state: string;
  language: string;
  votes: number;
  clickcount: number;
  codec: string;
  bitrate: number;
  isYouTube?: boolean;
  videoId?: string;
  isVideo?: boolean;
  // Local media sources (file upload / camera capture)
  isLocalFile?: boolean;
  isCamera?: boolean;
  mediaStream?: MediaStream;
  objectUrl?: string;
}

export interface LocationGeoProfile {
  country: string;
  countryCode: string;
  countryCodes?: string[];
  language: string;
  capital: string;
  description: string;
  nativeGreeting: string;
  genres: string[];
}

export interface BroadcastSegment {
  type: 'Station Profile' | 'Artist Spotlight' | 'Language Phrase' | 'Music History' | 'Broadcaster Tagline';
  originalText: string;
  estimatedDuration: number; // in seconds
}

export interface AIServiceSettings {
  endpoint: string;
  modelsEndpoint?: string;
  apiKey: string;
  model: string;
  voice?: string;
}

export interface AIProviderSettings {
  provider: 'gemini' | 'openai-compatible';
  llm: AIServiceSettings;
  stt: AIServiceSettings;
  tts: AIServiceSettings;
}
