import { AIProviderSettings } from "../types";
import { wsUrl } from "../apiBase";

export interface LiveTranslateTurn {
  originalText: string;
  translatedText: string;
  timestamp: Date;
}

export interface LiveTranslateState {
  status: "idle" | "connecting" | "connected" | "error";
  error: string | null;
  userTranscript: string;
  modelTranscript: string;
  turns: LiveTranslateTurn[];
}

// Convert Float32 to Int16 PCM array buffer
function float32ToInt16PCM(float32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(i * 2, val, true); // Little endian
  }
  return buffer;
}

// ArrayBuffer to Base64 helper (optimized batching to avoid main-thread jank)
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 16384; // Batch characters to prevent call stack size exceeded errors
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(i + chunkSize, len)) as any
    );
  }
  return btoa(binary);
}

// Base64 PCM elements to Float32 array (24000Hz)
function base64ToFloat32PCM(base64: string): Float32Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const numSamples = Math.floor(len / 2);
  const float32Array = new Float32Array(numSamples);
  
  const buffer = new ArrayBuffer(len);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  const view = new DataView(buffer);
  for (let i = 0; i < numSamples; i++) {
    float32Array[i] = view.getInt16(i * 2, true) / 32768.0;
  }
  return float32Array;
}

// Resample a Float32Array to 16000Hz using linear interpolation
function resampleTo16k(float32Array: Float32Array, fromSampleRate: number): Float32Array {
  if (fromSampleRate === 16000) return float32Array;
  const ratio = fromSampleRate / 16000;
  const newLength = Math.round(float32Array.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const nextOffset = i * ratio;
    const index = Math.floor(nextOffset);
    const weight = nextOffset - index;
    const nextIndex = index + 1 < float32Array.length ? index + 1 : index;
    result[i] = float32Array[index] * (1 - weight) + float32Array[nextIndex] * weight;
  }
  return result;
}

// Helper to encode Float32Array PCM to 16kHz Mono 16-bit WAV format
function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* file length */
  view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw pcm) */
  view.setUint16(20, 1, true);
  /* channel count (mono) */
  view.setUint16(22, 1, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * 2, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);

  // Write PCM audio samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, val, true);
  }

  return buffer;
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Global references for reusable audio session elements. This prevents DOMExceptions like:
// "HTMLMediaElement already connected to a different MediaElementSourceNode"
// when React components re-render or instantiate multiple LiveTranslateClients.
let globalMicContext: AudioContext | null = null;
let globalMicProcessor: ScriptProcessorNode | null = null;
let globalSourceNode: MediaElementAudioSourceNode | null = null;
let globalRadioGainNode: GainNode | null = null;
let globalPlaybackContext: AudioContext | null = null;

if (typeof window !== "undefined") {
  (window as any).__resumeMicContext = async () => {
    if (globalMicContext && globalMicContext.state === "suspended") {
      console.log("[Global Resume] Resuming globalMicContext audio pipeline...");
      try {
        await globalMicContext.resume();
      } catch (err) {
        console.warn("[Global Resume] Failed to resume globalMicContext:", err);
      }
    }
  };
}

export class LiveTranslateClient {
  private get micContext(): AudioContext | null { return globalMicContext; }
  private set micContext(val: AudioContext | null) { globalMicContext = val; }

  private get micProcessor(): ScriptProcessorNode | null { return globalMicProcessor; }
  private set micProcessor(val: ScriptProcessorNode | null) { globalMicProcessor = val; }

  private get sourceNode(): MediaElementAudioSourceNode | null { return globalSourceNode; }
  private set sourceNode(val: MediaElementAudioSourceNode | null) { globalSourceNode = val; }

  private get radioGainNode(): GainNode | null { return globalRadioGainNode; }
  private set radioGainNode(val: GainNode | null) { globalRadioGainNode = val; }

  private get playbackContext(): AudioContext | null { return globalPlaybackContext; }
  private set playbackContext(val: AudioContext | null) { globalPlaybackContext = val; }
  private nextStartTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];

  private accumulatedSamples: Float32Array[] = [];
  private totalSampleCount: number = 0;
  private mediaStream: MediaStream | null = null;
  private isVideoSource: boolean = false;

  // Recorded audio for WAV export
  private recordedOriginalPcm: Float32Array[] = [];
  private recordedOriginalCount: number = 0;
  private recordedTranslatedPcm: Float32Array[] = [];
  private recordedTranslatedCount: number = 0;
  private intervalId: any = null;
  private turnIntervalId: any = null;
  private silenceTimeoutId: any = null;
  private targetLanguage: string = "English";

  private ws: WebSocket | null = null;
  private analyserNode: AnalyserNode | null = null;
  private currentTurnOriginal: string = "";
  private currentTurnTranslated: string = "";
  private isNewTurn: boolean = true;

  private onStateChange: (state: LiveTranslateState) => void = () => {};
  private state: LiveTranslateState = {
    status: "idle",
    error: null,
    userTranscript: "",
    modelTranscript: "",
    turns: [],
  };

  constructor() {}

  private updateState(newState: Partial<LiveTranslateState>) {
    this.state = { ...this.state, ...newState };
    this.onStateChange(this.state);
  }

  public async connect(targetLanguage: string, onStateChange: (state: LiveTranslateState) => void, sourceLanguage?: string, voiceName?: string, voiceTone?: string, aiSettings?: AIProviderSettings, mediaStream?: MediaStream) {
    // Proactively initialize and resume globalPlaybackContext during the user's click gesture synchronous flow
    try {
      if (!this.playbackContext) {
        this.playbackContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 24000
        });
      }
      if (this.playbackContext.state === "suspended") {
        await this.playbackContext.resume();
      }
      this.nextStartTime = this.playbackContext.currentTime;
      console.log(`[Live Translate Client] Pre-initialized and resumed playbackContext! State is "${this.playbackContext.state}"`);
    } catch (playbackErr) {
      console.warn("[Live Translate Client] Failed to warm up playbackContext under gesture handler:", playbackErr);
    }

    if (this.state.status === "connected" || this.state.status === "connecting") {
      if (this.targetLanguage === targetLanguage) {
        return;
      }
      console.log(`[Live Translate Client] Re-establishing connection due to changed parameters (language)...`);
      this.disconnect();
    }

    // Unconditionally clear and reset the recording buffer and turn state at the start of every translation cycle
    this.accumulatedSamples = [];
    this.totalSampleCount = 0;
    this.currentTurnOriginal = "";
    this.currentTurnTranslated = "";
    this.isNewTurn = true;

    this.onStateChange = onStateChange;
    this.targetLanguage = targetLanguage;
    if (mediaStream) this.mediaStream = mediaStream;
    this.updateState({
      status: "connecting",
      error: null,
      userTranscript: "",
      modelTranscript: "",
    });

    try {
      let socketUrl = wsUrl(`/api/live-stream?targetLanguage=${encodeURIComponent(targetLanguage)}`);
      if (sourceLanguage) {
        socketUrl += `&sourceLanguage=${encodeURIComponent(sourceLanguage)}`;
      }
      if (voiceName) {
        socketUrl += `&voiceName=${encodeURIComponent(voiceName)}`;
      }
      if (voiceTone) {
        socketUrl += `&voiceTone=${encodeURIComponent(voiceTone)}`;
      }
      this.ws = new WebSocket(socketUrl);

      this.currentTurnOriginal = "";
      this.currentTurnTranslated = "";
      this.isNewTurn = true;

      let captureStarted = false;
      this.ws.onopen = () => {
        this.ws?.send(JSON.stringify({
          init: {
            aiSettings,
            targetLanguage,
            sourceLanguage,
            voiceName,
            voiceTone,
          },
        }));
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.ready && !captureStarted) {
            captureStarted = true;
            void (async () => {
              try {
                this.accumulatedSamples = [];
                this.totalSampleCount = 0;
                await this.startDOMAudioCapture();
                this.updateState({ status: "connected" });
                this.accumulatedSamples = [];
                this.totalSampleCount = 0;
                this.intervalId = setInterval(() => this.sendAccumulatedAudioStream(), 1000);
              } catch (captureErr: any) {
                console.error("[Live Translate Client] Failed to start audio capture:", captureErr);
                this.updateState({
                  status: "error",
                  error: captureErr.message || String(captureErr)
                });
                this.disconnect(true);
              }
            })();
            return;
          }
          
          const errorMessage = data.error || (data.type === "error" ? data.text : null);
          if (errorMessage) {
            this.updateState({
              status: "error",
              error: errorMessage
            });
            this.disconnect(true);
            return;
          }
          
          let updatedOriginal = this.currentTurnOriginal;
          let updatedTranslated = this.currentTurnTranslated;
          let hasTextUpdate = false;

          if (data.originalText) {
            updatedOriginal += (updatedOriginal ? " " : "") + data.originalText;
            this.currentTurnOriginal = updatedOriginal;
            hasTextUpdate = true;
          }
          if (data.translatedText) {
            updatedTranslated += (updatedTranslated ? " " : "") + data.translatedText;
            this.currentTurnTranslated = updatedTranslated;
            hasTextUpdate = true;
          }

          const commitCurrentTurn = () => {
            const orig = this.currentTurnOriginal.trim();
            const trans = this.currentTurnTranslated.trim();
            if (orig || trans) {
              const turns = [...this.state.turns];
              turns.push({
                originalText: orig || "(Listening...)",
                translatedText: trans || `(Translated to ${this.targetLanguage})`,
                timestamp: new Date()
              });
              this.updateState({
                turns: turns.slice(-20),
                userTranscript: "",
                modelTranscript: ""
              });
            } else {
              this.updateState({
                userTranscript: "",
                modelTranscript: ""
              });
            }
            this.currentTurnOriginal = "";
            this.currentTurnTranslated = "";
          };

          if (hasTextUpdate) {
            this.updateState({
              userTranscript: updatedOriginal,
              modelTranscript: updatedTranslated
            });

            // Reset dynamic silence timeout (wrap and commit turn after 8 seconds of silence)
            if (this.silenceTimeoutId) {
              clearTimeout(this.silenceTimeoutId);
            }
            this.silenceTimeoutId = setTimeout(() => {
              commitCurrentTurn();
            }, 8000);
          }

          if (data.turnComplete) {
            if (this.silenceTimeoutId) {
              clearTimeout(this.silenceTimeoutId);
              this.silenceTimeoutId = null;
            }
            commitCurrentTurn();
          }

          if (data.audio) {
            this.playAudioChunk(data.audio, data.audioMimeType);
            void this.recordTranslatedAudio(data.audio, data.audioMimeType);
          }
        } catch (e) {}
      };

      this.ws.onerror = (err) => {
        console.error("[Live Translate Client] WebSocket error:", err);
        this.updateState({
          status: "error",
          error: "WebSocket streaming error. Please check server connection."
        });
        this.disconnect(true);
      };

      this.ws.onclose = () => {
        console.log("[Live Translate Client] WebSocket closed.");
        this.disconnect(true);
      };

    } catch (err: any) {
      console.error("Failed to connect WebSocket stream:", err);
      this.updateState({
        status: "error",
        error: "Failed to establish live streaming session: " + (err.message || String(err)),
      });
      this.disconnect(true);
    }
  }

  private async startDOMAudioCapture() {
    try {
      // Camera / MediaStream source: capture directly from the stream without an <audio> element.
      if (this.mediaStream) {
        this.isVideoSource = false;
        if (!this.micContext) {
          this.micContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (this.micContext.state === "suspended") {
          await this.micContext.resume();
        }

        // Create MediaStream source node
        const streamSource = this.micContext.createMediaStreamSource(this.mediaStream!);
        this.analyserNode = this.micContext.createAnalyser();
        this.analyserNode.fftSize = 64;
        streamSource.connect(this.analyserNode);

        if (!this.micProcessor) {
          this.micProcessor = this.micContext.createScriptProcessor(4096, 1, 1);
        }
        try { streamSource.disconnect(this.micProcessor); } catch (e) {}
        streamSource.connect(this.micProcessor);
        try { this.micProcessor.disconnect(this.micContext.destination); } catch (e) {}
        // Do not play captured audio back (avoid feedback) — connect processor to a muted gain.
        const silentGain = this.micContext.createGain();
        silentGain.gain.value = 0;
        this.micProcessor.connect(silentGain);
        silentGain.connect(this.micContext.destination);

        this.micProcessor.onaudioprocess = (e) => {
          if (this.state.status !== "connected") return;
          let inputData = e.inputBuffer.getChannelData(0);
          const currentSampleRate = e.inputBuffer.sampleRate;
          if (currentSampleRate !== 16000) {
            inputData = resampleTo16k(inputData, currentSampleRate);
          } else {
            inputData = new Float32Array(inputData);
          }
          this.accumulatedSamples.push(inputData);
          this.totalSampleCount += inputData.length;
          this.recordedOriginalPcm.push(new Float32Array(inputData));
          this.recordedOriginalCount += inputData.length;
        };

        // Keep a reference so disconnect can clean up
        (this as any)._streamSource = streamSource;
        return;
      }

      const mediaElement = (document.querySelector("video") || document.querySelector("audio")) as HTMLMediaElement | null;
      this.isVideoSource = !!mediaElement && mediaElement.tagName === "VIDEO";
      if (!mediaElement) {
        throw new Error(
          "No active media player found in the page layout. Please select a station from the map and click play before translating."
        );
      }

      if (!mediaElement.crossOrigin && mediaElement.tagName === "VIDEO") {
        // video elements don't need crossOrigin for capture, but set anyway
      }
      if (mediaElement.tagName === "AUDIO" && !mediaElement.crossOrigin) {
        mediaElement.crossOrigin = "anonymous";
      }

      if (!this.micContext) {
        this.micContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      if (this.micContext.state === "suspended") {
        await this.micContext.resume();
      }

      if (!this.sourceNode) {
        this.sourceNode = this.micContext.createMediaElementSource(mediaElement);
        this.radioGainNode = this.micContext.createGain();
        this.radioGainNode.gain.value = this.isVideoSource ? 0 : 1.0;
        
        this.sourceNode.connect(this.radioGainNode);
        this.radioGainNode.connect(this.micContext.destination);

        this.analyserNode = this.micContext.createAnalyser();
        this.analyserNode.fftSize = 64;
        this.sourceNode.connect(this.analyserNode);

        // Auto-resume global AudioContext when the audio element plays to prevent silent playback
        const autoResume = () => {
          if (globalMicContext && globalMicContext.state === "suspended") {
            globalMicContext.resume().catch((err) => console.warn("[Web Audio Auto-Resume] Failed to resume AudioContext:", err));
          }
        };
        mediaElement.addEventListener("play", autoResume);
        mediaElement.addEventListener("playing", autoResume);
      }

      if (!this.micProcessor) {
        this.micProcessor = this.micContext.createScriptProcessor(4096, 1, 1);
      }

      // Safely disconnect processor first to avoid stacking duplicate audio routes/loops
      try {
        this.sourceNode.disconnect(this.micProcessor);
      } catch (e) {}
      this.sourceNode.connect(this.micProcessor);

      try {
        this.micProcessor.disconnect(this.micContext.destination);
      } catch (e) {}
      this.micProcessor.connect(this.micContext.destination);

      this.micProcessor.onaudioprocess = (e) => {
        if (this.state.status !== "connected") return;

        let inputData = e.inputBuffer.getChannelData(0);
        const currentSampleRate = e.inputBuffer.sampleRate;

        if (currentSampleRate !== 16000) {
          inputData = resampleTo16k(inputData, currentSampleRate);
        } else {
          inputData = new Float32Array(inputData);
        }

        this.accumulatedSamples.push(inputData);
        this.totalSampleCount += inputData.length;
        this.recordedOriginalPcm.push(new Float32Array(inputData));
        this.recordedOriginalCount += inputData.length;
      };

    } catch (err: any) {
      console.error("Failed to initialize DOM audio capture:", err);
      throw err;
    }
  }

  private sendAccumulatedAudioStream() {
    if (this.state.status !== "connected" || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.accumulatedSamples.length === 0 || this.totalSampleCount === 0) return;

    if (this.totalSampleCount < 4000) {
      // Keep accumulating if we have less than 250ms of audio, don't discard!
      return;
    }

    const resampled = new Float32Array(this.totalSampleCount);
    let offset = 0;
    for (const chunk of this.accumulatedSamples) {
      resampled.set(chunk, offset);
      offset += chunk.length;
    }

    this.accumulatedSamples = [];
    this.totalSampleCount = 0;

    const wavBuffer = encodeWAV(resampled, 16000);
    const base64Wav = arrayBufferToBase64(wavBuffer);

    this.ws.send(JSON.stringify({ audio: base64Wav }));
  }

  private playAudioChunk(base64Pcm: string, mimeType?: string) {
    try {
      if (!this.playbackContext) {
        this.playbackContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 24000
        });
      }

      if (this.playbackContext.state === "suspended") {
        this.playbackContext.resume();
      }

      const scheduleAudio = (audioBuffer: AudioBuffer) => {
        const source = this.playbackContext!.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.playbackContext!.destination);

        const currentTime = this.playbackContext!.currentTime;
        if (this.nextStartTime < currentTime) this.nextStartTime = currentTime;
        source.start(this.nextStartTime);
        this.nextStartTime += audioBuffer.duration;
        this.activeSources.push(source);

        if (!this.isVideoSource && this.radioGainNode && this.micContext) {
          this.radioGainNode.gain.setTargetAtTime(0.2, this.micContext.currentTime, 0.1);
        }
        source.onended = () => {
          this.activeSources = this.activeSources.filter((activeSource) => activeSource !== source);
          if (!this.isVideoSource && this.activeSources.length === 0 && this.radioGainNode && this.micContext) {
            this.radioGainNode.gain.setTargetAtTime(1.0, this.micContext.currentTime, 0.3);
          }
        };
      };

      if (mimeType) {
        const binary = atob(base64Pcm);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        void this.playbackContext.decodeAudioData(bytes.buffer).then(scheduleAudio).catch((error) => {
          console.error("[Live Translate Client] Failed to decode synthesized audio:", error);
        });
        return;
      }

      const float32Data = base64ToFloat32PCM(base64Pcm);
      if (float32Data.length === 0) return;
      const audioBuffer = this.playbackContext.createBuffer(1, float32Data.length, 24000);
      audioBuffer.getChannelData(0).set(float32Data);
      scheduleAudio(audioBuffer);
    } catch (err) {
      console.error("Audio playback error:", err);
    }
  }

  private stopAllPlayback() {
    this.activeSources.forEach((source) => {
      try {
        source.stop();
      } catch (e) {}
    });
    this.activeSources = [];
    this.nextStartTime = 0;
    if (!this.isVideoSource && this.radioGainNode && this.micContext) {
      this.radioGainNode.gain.setTargetAtTime(1.0, this.micContext.currentTime, 0.1);
    }
  }

  public disconnect(keepError = false) {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.turnIntervalId) {
      clearInterval(this.turnIntervalId);
      this.turnIntervalId = null;
    }
    if (this.silenceTimeoutId) {
      clearTimeout(this.silenceTimeoutId);
      this.silenceTimeoutId = null;
    }

    if (this.ws) {
      try {
        // Clear listeners to prevent background close/error events of the closed socket from destroying the new session
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.send(JSON.stringify({ stop: true }));
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }

    if (this.micProcessor) {
      this.micProcessor.onaudioprocess = null;
      try {
        this.micProcessor.disconnect();
      } catch (e) {}
    }

    if ((this as any)._streamSource) {
      try { (this as any)._streamSource.disconnect(); } catch (e) {}
      (this as any)._streamSource = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => {
        try { t.stop(); } catch (e) {}
      });
      this.mediaStream = null;
    }

    if (this.sourceNode && this.micProcessor) {
      try {
        this.sourceNode.disconnect(this.micProcessor);
      } catch (e) {}
    }

    const mediaElement = document.querySelector("video") || document.querySelector("audio");
    const isRadioPlaying = !!(mediaElement && !mediaElement.paused && !mediaElement.ended);

    if (!isRadioPlaying && this.micContext && this.micContext.state !== "closed") {
      this.micContext.suspend().catch(() => {});
    }

    this.stopAllPlayback();
    if (this.playbackContext) {
      if (this.playbackContext.state !== "closed") {
        this.playbackContext.close().catch(() => {});
      }
      this.playbackContext = null;
    }

    this.currentTurnOriginal = "";
    this.currentTurnTranslated = "";
    this.isNewTurn = true;
    this.accumulatedSamples = [];
    this.totalSampleCount = 0;
    this.recordedOriginalPcm = [];
    this.recordedOriginalCount = 0;
    this.recordedTranslatedPcm = [];
    this.recordedTranslatedCount = 0;
    this.isVideoSource = false;

    this.updateState({ 
      status: keepError ? "error" : "idle",
      error: keepError ? this.state.error : null,
      userTranscript: "",
      modelTranscript: ""
    });
  }

  private async recordTranslatedAudio(base64: string, mimeType?: string): Promise<void> {
    try {
      if (!this.playbackContext) return;
      if (mimeType) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const buf = await this.playbackContext.decodeAudioData(bytes.buffer.slice(0));
        const ch = buf.getChannelData(0);
        // Resample to 24000 if needed
        let data = ch;
        if (buf.sampleRate !== 24000) {
          const ratio = buf.sampleRate / 24000;
          const newLen = Math.round(ch.length / ratio);
          data = new Float32Array(newLen);
          for (let i = 0; i < newLen; i++) {
            const srcIdx = i * ratio;
            const idx = Math.floor(srcIdx);
            const w = srcIdx - idx;
            const next = idx + 1 < ch.length ? idx + 1 : idx;
            data[i] = ch[idx] * (1 - w) + ch[next] * w;
          }
        }
        this.recordedTranslatedPcm.push(new Float32Array(data));
        this.recordedTranslatedCount += data.length;
      } else {
        const data = base64ToFloat32PCM(base64);
        if (data.length > 0) {
          this.recordedTranslatedPcm.push(new Float32Array(data));
          this.recordedTranslatedCount += data.length;
        }
      }
    } catch (e) {
      console.warn("[Live Translate] Failed to record translated audio:", e);
    }
  }

  private buildWav(pcmChunks: Float32Array[], sampleRate: number): Blob {
    let total = 0;
    for (const c of pcmChunks) total += c.length;
    const pcm = new Int16Array(total);
    let off = 0;
    for (const c of pcmChunks) {
      for (let i = 0; i < c.length; i++) {
        const s = Math.max(-1, Math.min(1, c[i]));
        pcm[off++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
    }
    const buffer = new ArrayBuffer(44 + pcm.length * 2);
    const view = new DataView(buffer);
    const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + pcm.length * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, pcm.length * 2, true);
    let o = 44;
    for (let i = 0; i < pcm.length; i++, o += 2) view.setInt16(o, pcm[i], true);
    return new Blob([buffer], { type: "audio/wav" });
  }

  public hasRecordedOriginal(): boolean {
    return this.recordedOriginalCount > 0;
  }

  public hasRecordedTranslated(): boolean {
    return this.recordedTranslatedCount > 0;
  }

  public exportOriginalWav(): void {
    if (this.recordedOriginalCount === 0) return;
    const blob = this.buildWav(this.recordedOriginalPcm, 16000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `world_radio_original_${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  public exportTranslatedWav(): void {
    if (this.recordedTranslatedCount === 0) return;
    const blob = this.buildWav(this.recordedTranslatedPcm, 24000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `world_radio_translated_${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  public getLiveState(): LiveTranslateState {
    return this.state;
  }

  public clearHistory() {
    this.recordedOriginalPcm = [];
    this.recordedOriginalCount = 0;
    this.recordedTranslatedPcm = [];
    this.recordedTranslatedCount = 0;
    this.updateState({
      userTranscript: "",
      modelTranscript: "",
      turns: []
    });
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyserNode;
  }
}
