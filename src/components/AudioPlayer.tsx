import { useState, useEffect, useRef } from "react";
import { RadioStation } from "../types";
import { apiUrl } from "../apiBase";
import { useTranslation } from "react-i18next";
import { Play, Pause, Volume2, VolumeX, ShieldAlert, BadgeInfo, Disc3, Radio, Youtube, Maximize2, Minimize2, X } from "lucide-react";
import Hls from "hls.js";

interface AudioPlayerProps {
  station: RadioStation | null;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
}

function extractYouTubeVideoId(station: RadioStation | null): string {
  if (!station) return "";
  if (station.videoId) return station.videoId;
  const url = station.url || "";
  if (url.startsWith("yt-")) return url.replace("yt-", "");
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : "kJQP7kiw5Fk";
}

export default function AudioPlayer({ station, isPlaying, setIsPlaying }: AudioPlayerProps) {
  const { t } = useTranslation();
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [showVideoModal, setShowVideoModal] = useState(true);

  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [videoDelay, setVideoDelay] = useState<number>(() => {
    try { return parseFloat(localStorage.getItem("world_radio_video_delay") || "0") || 0; } catch { return 0; }
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const lastUrlRef = useRef<string>("");
  const playPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  const isYouTubeSource = Boolean(
    station?.isYouTube ||
    station?.url?.includes("youtube.com") ||
    station?.url?.includes("youtu.be") ||
    station?.stationuuid?.startsWith("yt-")
  );

  const isCameraSource = Boolean(station?.isCamera);
  const isLocalFileSource = Boolean(station?.isLocalFile || station?.url?.startsWith("blob:") || station?.url?.startsWith("data:"));
  const isVideoSource = Boolean(station?.isVideo);

  const videoId = extractYouTubeVideoId(station);

  // Video playback (for uploaded video files) with optional delay
  useEffect(() => {
    if (!isVideoSource || !station || !videoRef.current) return;
    const video = videoRef.current;
    if (isPlaying) {
      const url = station.url_resolved || station.url;
      if (video.src !== url) {
        video.src = url;
        video.load();
      }
      if (videoDelay > 0) {
        const t = setTimeout(() => {
          video.play().catch(() => {});
        }, videoDelay * 1000);
        return () => clearTimeout(t);
      } else {
        video.play().catch(() => {});
      }
    } else {
      video.pause();
    }
  }, [station, isPlaying, isVideoSource, videoDelay]);

  // Synchronize audio stream play/pause when station or isPlaying changes
  useEffect(() => {
    if (!audioRef.current) return;

    if (!station) {
      lastUrlRef.current = "";
      playPromiseRef.current = null;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      try {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
      } catch (e) {}
      setIsPlaying(false);
      setLoading(false);
      setStreamError(null);
      return;
    }

    // Camera capture: no audio element playback (avoid feedback); capture happens via MediaStream.
    if (isCameraSource) {
      setLoading(false);
      setStreamError(null);
      return;
    }

    // Video sources are handled by the dedicated video effect above.
    if (isVideoSource) {
      setLoading(false);
      setStreamError(null);
      return;
    }

    const targetUrl = isYouTubeSource
      ? apiUrl(`/api/youtube-stream?url=${encodeURIComponent(station.url)}`)
      : (station.url_resolved || station.url);

    const proxiedUrl = (isYouTubeSource || isLocalFileSource)
      ? targetUrl
      : apiUrl(`/api/proxy-stream?url=${encodeURIComponent(targetUrl)}`);

    const isHls = !isYouTubeSource && (targetUrl.toLowerCase().includes(".m3u8") || station.url.toLowerCase().includes(".m3u8"));

    let isCancelled = false;

    if (isPlaying) {
      const startPlayback = async () => {
        if (typeof window !== "undefined" && typeof (window as any).__resumeMicContext === "function") {
          try {
            await (window as any).__resumeMicContext();
          } catch (e) {
            console.warn("[Audio Setup] Failed to resume Web Audio context before play:", e);
          }
        }

        if (isCancelled || !audioRef.current) return;

        const currentActiveUrl = isHls ? targetUrl : proxiedUrl;
        const isNewSource = lastUrlRef.current !== currentActiveUrl;
        if (isNewSource) {
          lastUrlRef.current = currentActiveUrl;
          setStreamError(null);
          setLoading(true);

          if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
          }

          try {
            audioRef.current.pause();
          } catch (e) {}

          if (isHls) {
            if (audioRef.current.canPlayType("application/vnd.apple.mpegurl")) {
              audioRef.current.src = targetUrl;
              audioRef.current.load();
            } else if (Hls.isSupported()) {
              const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                maxBufferSize: 0, 
                maxBufferLength: 1.5,
                liveDurationInfinity: true,
              });
              hlsRef.current = hls;
              
              hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                  if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    try {
                      hls.destroy();
                      hlsRef.current = null;
                      if (audioRef.current) {
                        audioRef.current.src = proxiedUrl;
                        audioRef.current.play().catch(() => setErrorState());
                      }
                    } catch (err) {
                      setErrorState();
                    }
                  } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    hls.recoverMediaError();
                  } else {
                    setErrorState();
                  }
                }
              });

              hls.loadSource(targetUrl);
              hls.attachMedia(audioRef.current);
            } else {
              audioRef.current.src = proxiedUrl;
              audioRef.current.load();
            }
          } else {
            audioRef.current.src = proxiedUrl;
            audioRef.current.load();
          }
        }

        setLoading(true);
        try {
          const playPromise = audioRef.current.play();
          playPromiseRef.current = playPromise;
          await playPromise;

          if (isCancelled) return;
          if (playPromiseRef.current === playPromise) {
            setLoading(false);
            setStreamError(null);
          }
        } catch (err: any) {
          if (isCancelled) return;
          if (err.name === "AbortError" || err.message?.includes("interrupted")) {
            console.log("Audio playback interrupted by a newer state change (expected behavior).");
          } else {
            console.error("Audio playback failed:", err);
            setErrorState();
          }
        }
      };

      startPlayback();
    } else {
      setLoading(false);
      playPromiseRef.current = null;
      lastUrlRef.current = "";
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      try {
        audioRef.current.pause();
      } catch (e) {}
    }

    return () => {
      isCancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [station, isPlaying, isYouTubeSource, isCameraSource, isLocalFileSource, isVideoSource]);

  // Synchronize volume sliders
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  const setErrorState = () => {
    setLoading(false);
    setIsPlaying(false);
    setStreamError("Failed to stream broadcast. The source might be offline or blocked.");
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  return (
    <>
      {/* Floating YouTube Video Player Modal / PiP when YouTube is active */}
      {isYouTubeSource && station && isPlaying && showVideoModal && (
        <div className="fixed bottom-24 right-4 md:right-6 z-50 w-[320px] sm:w-[380px] bg-slate-900 border border-rose-500/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950 border-b border-slate-800 text-slate-100">
            <div className="flex items-center gap-2 truncate">
              <Youtube className="w-4 h-4 text-rose-500 flex-shrink-0" />
              <span className="font-display font-bold text-xs truncate">{station.name}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowVideoModal(false)}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                title="Minimize video player"
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setIsPlaying(false);
                  setShowVideoModal(false);
                }}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-rose-400 transition-colors"
                title="Close video"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="relative w-full aspect-video bg-black">
            <iframe
              src={`https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1`}
              title={station.name}
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}

      {/* Minimized YouTube floating trigger button */}
      {isYouTubeSource && station && isPlaying && !showVideoModal && (
        <button
          onClick={() => setShowVideoModal(true)}
          className="fixed bottom-24 right-4 md:right-6 z-50 flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white shadow-xl transition-all cursor-pointer animate-bounce"
          title="Open YouTube video player"
        >
          <Youtube className="w-4 h-4" />
          <span className="text-xs font-semibold">Show YouTube Video</span>
        </button>
      )}

      {/* Floating Video Player for uploaded video files */}
      {isVideoSource && station && isPlaying && (
        <div className={`fixed bottom-24 right-4 md:right-6 z-50 w-[320px] sm:w-[420px] bg-slate-900 border border-violet-500/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-300 ${showVideoModal ? "" : "hidden"}`}>
          <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950 border-b border-slate-800 text-slate-100">
            <div className="flex items-center gap-2 truncate">
              <span className="font-display font-bold text-xs truncate">{station.name}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowVideoModal(false)}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                title="Minimize"
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setIsPlaying(false); setShowVideoModal(false); }}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-rose-400 transition-colors"
                title="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="relative w-full aspect-video bg-black">
            <video
              ref={videoRef}
              className="w-full h-full"
              controls
              playsInline
            />
          </div>
          <div className="px-3.5 py-2 bg-slate-950 border-t border-slate-800 flex items-center gap-2 text-[10px] text-slate-400">
            <span>Video delay (s):</span>
            <input
              type="number"
              min="0"
              max="30"
              step="0.5"
              value={videoDelay}
              onChange={(e) => {
                const v = parseFloat(e.target.value) || 0;
                setVideoDelay(v);
                try { localStorage.setItem("world_radio_video_delay", String(v)); } catch {}
              }}
              className="w-14 bg-slate-800 text-slate-100 rounded px-1.5 py-0.5 text-[10px] border border-slate-700"
            />
          </div>
        </div>
      )}
      {/* Minimized video trigger */}
      {isVideoSource && station && isPlaying && !showVideoModal && (
        <button
          onClick={() => setShowVideoModal(true)}
          className="fixed bottom-24 right-4 md:right-6 z-50 flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white shadow-xl transition-all cursor-pointer animate-bounce"
          title="Show video"
        >
          <span className="text-xs font-semibold">Show Video</span>
        </button>
      )}
      {/* (video element is kept inside the modal above; minimized state hides the modal but the element stays mounted via the minimized branch below) */}
      {/* video element stays mounted inside the modal; minimized state only hides the container */}

      <div className="bg-white dark:bg-slate-900 border-t border-slate-200/50 dark:border-slate-800/50 py-3.5 px-6 flex flex-col md:flex-row gap-4 items-center justify-between shadow-lg relative min-h-[75px]">
        
        {/* HTML5 audio stream player (active for both radio & YouTube live capture by Gemini Live Translate) */}
        <audio
          ref={audioRef}
          crossOrigin="anonymous"
          onCanPlay={() => {
            setLoading(false);
            setStreamError(null);
          }}
          onWaiting={() => setLoading(true)}
          onError={() => {
            if (!isPlaying || !station || !audioRef.current) return;
            const error = audioRef.current.error;
            if (!error || error.code === 1) return;
            const currentSrc = audioRef.current.src || "";
            if (!currentSrc || currentSrc === window.location.href || !currentSrc.startsWith("http")) return;

            if (!isYouTubeSource) {
              const fallbackProxied = apiUrl(`/api/proxy-stream?url=${encodeURIComponent(station.url)}`);
              if (currentSrc && !currentSrc.includes(encodeURIComponent(station.url))) {
                audioRef.current.src = fallbackProxied;
                audioRef.current.play().catch(() => setErrorState());
              } else {
                setErrorState();
              }
            } else {
              // For YouTube, video iframe plays video visually; audio element serves live translation pipeline.
              // If the stream fails (ytdl cannot extract audio), report an error and stop.
              setErrorState();
            }
          }}
          onEnded={() => setIsPlaying(false)}
        />

        {/* Station information branding */}
        <div className="flex items-center gap-3 w-full md:w-1/3">
          {station ? (
            <>
              <div className="relative">
                <div className={`w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-center overflow-hidden flex-shrink-0 ${isPlaying ? 'animate-spin [animation-duration:8s]' : ''}`}>
                  {station.favicon ? (
                    <img
                      src={station.favicon}
                      alt=""
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        const tgt = e.target as HTMLImageElement;
                        tgt.style.display = 'none';
                      }}
                      className="w-full h-full object-cover"
                    />
                  ) : isYouTubeSource ? (
                    <Youtube className="w-5 h-5 text-rose-500" />
                  ) : (
                    <Radio className="w-5 h-5 text-emerald-500" />
                  )}
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 bg-green-500 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-scale" />
                </div>
              </div>

              <div className="flex-1 overflow-hidden">
                <p className="font-display font-bold text-sm text-slate-800 dark:text-slate-100 truncate flex items-center gap-1.5">
                  {station.name}
                  {isYouTubeSource && (
                    <span className="text-[9px] font-mono bg-rose-500/10 text-rose-500 px-1.5 py-0.5 rounded">YouTube</span>
                  )}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-300 truncate capitalize">
                  {station.tags ? station.tags.split(',').slice(0, 2).join(' • ') : 'Global Channel'}
                </p>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-slate-400 dark:text-slate-400">
              <button
                type="button"
                className="w-11 h-11 rounded-full border border-dashed border-slate-200 dark:border-slate-800 flex items-center justify-center flex-shrink-0"
                aria-label="No station loaded"
              >
                <Disc3 className="w-5 h-5 text-slate-300 dark:text-slate-500" />
              </button>
              <div className="flex flex-col">
                <span className="text-xs font-semibold">{t("player.noStation")}</span>
                <span className="text-[10px] text-slate-400">{t("player.noStationDesc")}</span>
              </div>
            </div>
          )}
        </div>

        {/* Media Player Primary Controls */}
        <div className="flex flex-col items-center gap-1 w-full md:w-1/3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={!station}
              className={`w-10 h-10 rounded-full flex items-center justify-center text-white transition-all shadow ${
                !station
                  ? "bg-slate-200 dark:bg-slate-800 cursor-not-allowed text-slate-400"
                  : isPlaying
                  ? "bg-emerald-600 hover:bg-emerald-700 hover:scale-105"
                  : "bg-emerald-500 hover:bg-emerald-600 hover:scale-105"
              }`}
              id="control_play_pause"
              title={!station ? "No station tuned" : loading ? "Loading..." : isPlaying ? "Pause broadcast" : "Play broadcast"}
            >
              {loading ? (
                <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current translate-x-[1px]" />
              )}
            </button>
          </div>
        </div>

        {/* Media Player Volume & Actions */}
        <div className="flex items-center justify-end gap-3.5 w-full md:w-1/3">
          <div className="flex items-center gap-2 text-slate-500">
            <button
              onClick={toggleMute}
              className="hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              id="control_mute"
              title={isMuted || volume === 0 ? "Unmute" : "Mute"}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                setVolume(parseFloat(e.target.value));
                setIsMuted(false);
              }}
              className="w-20 accent-emerald-500 h-1 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              title={`Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
            />
          </div>

          {/* Playback Speed Control */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="font-mono text-[11px]">Speed:</span>
            <select
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
              className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-2 py-1 rounded-lg border border-slate-200/80 dark:border-slate-700 focus:outline-none cursor-pointer font-mono text-xs"
              title="Adjust broadcast playback speed"
            >
              <option value="0.5">0.5x</option>
              <option value="0.75">0.75x</option>
              <option value="1.0">1.0x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
              <option value="2.0">2.0x</option>
            </select>
          </div>
        </div>

      </div>
    </>
  );
}
