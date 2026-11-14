import { useState, useEffect, FormEvent, useRef, ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { apiUrl } from "../apiBase";
import { RadioStation, LocationGeoProfile } from "../types";
import { Radio, Play, Volume2, ShieldAlert, BadgeCheck, Youtube, Search, Plus, Globe, Upload, Camera, FileAudio } from "lucide-react";

interface StationListProps {
  currentCountryProfile: LocationGeoProfile | null;
  onSelectStation: (station: RadioStation) => void;
  activeStation: RadioStation | null;
  isPlaying: boolean;
  isProfileLoading?: boolean;
}

const DEFAULT_YOUTUBE_STATIONS: RadioStation[] = [
  {
    changeid: "yt-1",
    stationuuid: "yt-bbc-news",
    name: "BBC News Live Stream",
    url: "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
    url_resolved: "/api/youtube-stream?url=" + encodeURIComponent("https://www.youtube.com/watch?v=kJQP7kiw5Fk"),
    homepage: "https://youtube.com/@bbcnews",
    favicon: "https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg",
    tags: "news,world,english,youtube",
    country: "United Kingdom",
    countrycode: "GB",
    state: "London (YouTube)",
    language: "english",
    votes: 50000,
    clickcount: 100000,
    codec: "AAC / Opus",
    bitrate: 160,
  },
  {
    changeid: "yt-2",
    stationuuid: "yt-lofigirl",
    name: "Lofi Girl - Live Radio / Beats to Relax to",
    url: "https://www.youtube.com/watch?v=jfKfPfyJRdk",
    url_resolved: "/api/youtube-stream?url=" + encodeURIComponent("https://www.youtube.com/watch?v=jfKfPfyJRdk"),
    homepage: "https://youtube.com/@lofigirl",
    favicon: "https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg",
    tags: "lofi,chill,music,youtube",
    country: "France",
    countrycode: "FR",
    state: "Paris (YouTube)",
    language: "english",
    votes: 95000,
    clickcount: 200000,
    codec: "AAC / Opus",
    bitrate: 160,
  },
  {
    changeid: "yt-3",
    stationuuid: "yt-aljazeera",
    name: "Al Jazeera English Live",
    url: "https://www.youtube.com/watch?v=bNyUyrw0PHo",
    url_resolved: "/api/youtube-stream?url=" + encodeURIComponent("https://www.youtube.com/watch?v=bNyUyrw0PHo"),
    homepage: "https://youtube.com/@aljazeeraenglish",
    favicon: "https://i.ytimg.com/vi/bNyUyrw0PHo/hqdefault.jpg",
    tags: "news,middle east,global,youtube",
    country: "Qatar",
    countrycode: "QA",
    state: "Doha (YouTube)",
    language: "english",
    votes: 42000,
    clickcount: 90000,
    codec: "AAC / Opus",
    bitrate: 160,
  },
  {
    changeid: "yt-4",
    stationuuid: "yt-nasa",
    name: "NASA TV Live - Space Station & Earth View",
    url: "https://www.youtube.com/watch?v=21X5lGlDOfg",
    url_resolved: "/api/youtube-stream?url=" + encodeURIComponent("https://www.youtube.com/watch?v=21X5lGlDOfg"),
    homepage: "https://youtube.com/@nasa",
    favicon: "https://i.ytimg.com/vi/21X5lGlDOfg/hqdefault.jpg",
    tags: "science,space,nasa,youtube",
    country: "United States",
    countrycode: "US",
    state: "Washington D.C. (YouTube)",
    language: "english",
    votes: 38000,
    clickcount: 85000,
    codec: "AAC / Opus",
    bitrate: 160,
  },
  {
    changeid: "yt-5",
    stationuuid: "yt-france24",
    name: "France 24 English Live News",
    url: "https://www.youtube.com/watch?v=hTWKbfoikeg",
    url_resolved: "/api/youtube-stream?url=" + encodeURIComponent("https://www.youtube.com/watch?v=hTWKbfoikeg"),
    homepage: "https://youtube.com/@france24",
    favicon: "https://i.ytimg.com/vi/hTWKbfoikeg/hqdefault.jpg",
    tags: "news,france,europe,youtube",
    country: "France",
    countrycode: "FR",
    state: "Paris (YouTube)",
    language: "english",
    votes: 29000,
    clickcount: 62000,
    codec: "AAC / Opus",
    bitrate: 160,
  },
  {
    changeid: "yt-6",
    stationuuid: "yt-dw",
    name: "DW News Live - German & Global News",
    url: "https://www.youtube.com/watch?v=LuZtt7yQpYw",
    url_resolved: "/api/youtube-stream?url=" + encodeURIComponent("https://www.youtube.com/watch?v=LuZtt7yQpYw"),
    homepage: "https://youtube.com/@dwnews",
    favicon: "https://i.ytimg.com/vi/LuZtt7yQpYw/hqdefault.jpg",
    tags: "news,germany,europe,youtube",
    country: "Germany",
    countrycode: "DE",
    state: "Berlin (YouTube)",
    language: "english",
    votes: 31000,
    clickcount: 70000,
    codec: "AAC / Opus",
    bitrate: 160,
  }
];

export default function StationList({
  currentCountryProfile,
  onSelectStation,
  activeStation,
  isPlaying,
  isProfileLoading = false,
}: StationListProps) {
  const { t } = useTranslation();
  const [sourceMode, setSourceMode] = useState<"radio" | "youtube" | "media">("radio");
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  
  // YouTube specific states
  const [youtubeUrlInput, setYoutubeUrlInput] = useState("");
  const [youtubeSearchQuery, setYoutubeSearchQuery] = useState("");
  const [youtubeStations, setYoutubeStations] = useState<RadioStation[]>(DEFAULT_YOUTUBE_STATIONS);
  const [isYoutubeSearching, setIsYoutubeSearching] = useState(false);

  // Local media sources (file upload / camera capture)
  const [mediaStations, setMediaStations] = useState<RadioStation[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Default Global Broadcast fallbacks if region is empty or has poor service
  const DEFAULT_GLOBAL_STATIONS: RadioStation[] = [
    {
      changeid: "glob-1",
      stationuuid: "global-bbc",
      name: "BBC World Service",
      url: "http://stream.live.vc.bbcmedia.co.uk/bbc_world_service",
      url_resolved: "https://bbradio.gcdn.co/bbcworldservice",
      homepage: "https://bbc.co.uk",
      favicon: "https://www.bbc.co.uk/favicon.ico",
      tags: "news,talk,world,english",
      country: "United Kingdom",
      countrycode: "GB",
      state: "London",
      language: "english",
      votes: 12053,
      clickcount: 24520,
      codec: "MP3",
      bitrate: 128
    },
    {
      changeid: "glob-2",
      stationuuid: "global-fip",
      name: "FIP Paris",
      url: "https://stream.radiofrance.fr/fip/fip.m3u8",
      url_resolved: "https://stream.radiofrance.fr/fip/fip_hifi.mp3",
      homepage: "https://fip.fr",
      favicon: "https://www.radiofrance.fr/favicon.ico",
      tags: "eclectic,jazz,rock,chanson,france",
      country: "France",
      countrycode: "FR",
      state: "Paris, Île-de-France",
      language: "french",
      votes: 9540,
      clickcount: 18451,
      codec: "MP3",
      bitrate: 192
    },
    {
      changeid: "glob-3",
      stationuuid: "global-somafm",
      name: "SomaFM - Groove Salad",
      url: "https://somafm.com/groovesalad130.pls",
      url_resolved: "https://ice1.somafm.com/groovesalad-128-mp3",
      homepage: "https://somafm.com",
      favicon: "https://somafm.com/img3/groovesalad120.png",
      tags: "ambient,chillout,downtempo,groove",
      country: "United States",
      countrycode: "US",
      state: "San Francisco, California",
      language: "english",
      votes: 8450,
      clickcount: 14500,
      codec: "MP3",
      bitrate: 128
    },
    {
      changeid: "glob-4",
      stationuuid: "global-kexp",
      name: "KEXP Seattle",
      url: "https://kexp-mp3-128.stream.publicradio.org/kexp-mp3-128",
      url_resolved: "https://kexp-mp3-128.stream.publicradio.org/kexp-mp3-128",
      homepage: "https://kexp.org",
      favicon: "https://www.kexp.org/static/images/favicon.ico",
      tags: "indie,alternative,rock,eclectic",
      country: "United States",
      countrycode: "US",
      state: "Seattle, Washington",
      language: "english",
      votes: 11200,
      clickcount: 16290,
      codec: "MP3",
      bitrate: 128
    },
    {
      changeid: "glob-5",
      stationuuid: "global-ibiza",
      name: "Ibiza Global Radio",
      url: "https://ibizaglobalradio-com.ibizaglobalradio.com:8024/stream",
      url_resolved: "https://live.ibizaglobalradio.com/static/hifi.mp3",
      homepage: "https://ibizaglobalradio.com",
      favicon: "https://ibizaglobalradio.com/favicon.ico",
      tags: "electronic,deep house,tech house,dance",
      country: "Spain",
      countrycode: "ES",
      state: "Ibiza, Balearic Islands",
      language: "spanish",
      votes: 7520,
      clickcount: 13200,
      codec: "MP3",
      bitrate: 128
    }
  ];

  useEffect(() => {
    if (!currentCountryProfile) {
      setStations(DEFAULT_GLOBAL_STATIONS);
      return;
    }

    setLoading(true);
    setSearchQuery("");

    const rawCodes = currentCountryProfile?.countryCodes && currentCountryProfile.countryCodes.length > 0
      ? currentCountryProfile.countryCodes
      : [currentCountryProfile?.countryCode];

    const codesToQuery = (rawCodes || []).filter(
      (code): code is string => typeof code === "string" && code.trim().length > 0
    );

    const fetchPromises = codesToQuery.map(codeString => {
      const code = codeString.toLowerCase().trim();
      return fetch(`https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/${code}?limit=30&hidebroken=true&order=clickcount&reverse=true`)
        .then((res) => {
          if (!res.ok) return [];
          return res.json();
        })
        .catch(() => []);
    });

    Promise.all(fetchPromises)
      .then((resultsArray: RadioStation[][]) => {
        let combinedStations: RadioStation[] = resultsArray.flat();
        const seenUuids = new Set<string>();
        combinedStations = combinedStations.filter((s) => {
          const mainUrl = s.url_resolved || s.url;
          if (!mainUrl || !mainUrl.startsWith("http")) return false;
          if (seenUuids.has(s.stationuuid)) return false;
          seenUuids.add(s.stationuuid);
          return true;
        });

        combinedStations.sort((a, b) => (b.clickcount || b.votes || 0) - (a.clickcount || a.votes || 0));

        if (combinedStations.length === 0) {
          fetch(`https://de1.api.radio-browser.info/json/stations/search?country=${encodeURIComponent(currentCountryProfile.country)}&limit=30&hidebroken=true&order=clickcount&reverse=true`)
            .then((fallRes) => fallRes.json())
            .then((fallData: RadioStation[]) => {
              const resFilter = fallData.filter((s) => {
                const mainUrl = s.url_resolved || s.url;
                return mainUrl && mainUrl.startsWith("http");
              });
              if (resFilter.length === 0) {
                setStations(DEFAULT_GLOBAL_STATIONS.map(s => ({
                  ...s,
                  state: "Regional Stream"
                })));
              } else {
                setStations(resFilter);
              }
              setLoading(false);
            })
            .catch(() => {
              setStations(DEFAULT_GLOBAL_STATIONS);
              setLoading(false);
            });
        } else {
          setStations(combinedStations.slice(0, 45));
          setLoading(false);
        }
      })
      .catch(() => {
        setStations(DEFAULT_GLOBAL_STATIONS);
        setLoading(false);
      });
  }, [currentCountryProfile]);

  const handleSearchYouTube = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!youtubeSearchQuery.trim()) return;

    setIsYoutubeSearching(true);
    try {
      const res = await fetch(apiUrl(`/api/youtube-search?q=${encodeURIComponent(youtubeSearchQuery)}`));
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setYoutubeStations(data);
      }
    } catch (err) {
      console.error("YouTube search failed:", err);
    } finally {
      setIsYoutubeSearching(false);
    }
  };

  const handleAddCustomYouTubeUrl = (e: FormEvent) => {
    e.preventDefault();
    const url = youtubeUrlInput.trim();
    if (!url) return;

    // Extract video ID or generate clean station entry
    const customStation: RadioStation = {
      changeid: `yt-custom-${Date.now()}`,
      stationuuid: `yt-custom-${Math.random()}`,
      name: `Custom YouTube Stream / Video`,
      url: url,
      url_resolved: `/api/youtube-stream?url=${encodeURIComponent(url)}`,
      homepage: url,
      favicon: "https://www.youtube.com/s/desktop/f8de9d96/img/favicon.ico",
      tags: "youtube,custom,live",
      country: "YouTube",
      countrycode: "YT",
      state: "Direct URL Source",
      language: "english",
      votes: 1000,
      clickcount: 1000,
      codec: "AAC / Opus",
      bitrate: 160,
    };

    setYoutubeStations([customStation, ...youtubeStations]);
    setYoutubeUrlInput("");
    onSelectStation(customStation);
  };

  // Local media handlers
  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    const isVideo = file.type.startsWith("video/");
    const station: RadioStation = {
      changeid: `local-${Date.now()}`,
      stationuuid: `local-${Math.random()}`,
      name: file.name || "Local media file",
      url: objectUrl,
      url_resolved: objectUrl,
      homepage: "",
      favicon: "",
      tags: isVideo ? "local,video,file" : "local,audio,file",
      country: "Local",
      countrycode: "LC",
      state: "Local file",
      language: "english",
      votes: 0,
      clickcount: 0,
      codec: isVideo ? "Video" : "Audio",
      bitrate: 0,
      isLocalFile: true,
      isVideo: isVideo,
      objectUrl,
    };
    setMediaStations((prev) => [station, ...prev]);
    onSelectStation(station);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCameraCapture = async () => {
    try {
      // Combined camera+mic prompts are flaky on many phones (they can stall until the
      // browser's permission timeout), so fall back to microphone-only before giving up.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } catch (combinedErr) {
        console.warn("camera+mic capture failed, retrying with microphone only:", combinedErr);
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      const station: RadioStation = {
        changeid: `cam-${Date.now()}`,
        stationuuid: `cam-${Math.random()}`,
        name: "Camera / Microphone capture",
        url: "",
        url_resolved: "",
        homepage: "",
        favicon: "",
        tags: "camera,microphone,live",
        country: "Local",
        countrycode: "LC",
        state: "Camera capture",
        language: "english",
        votes: 0,
        clickcount: 0,
        codec: "Live",
        bitrate: 0,
        isCamera: true,
        mediaStream: stream,
      };
      setMediaStations((prev) => [station, ...prev]);
      onSelectStation(station);
    } catch (err: any) {
      console.error("Camera capture failed:", err);
      const isBlocked = err?.name === "NotAllowedError" || err?.name === "SecurityError";
      alert(
        (isBlocked
          ? "Доступ к камере/микрофону запрещён. Разрешите доступ в настройках сайта (значок 🔒 слева от адреса → Разрешения → Камера/Микрофон) и повторите.\n\n"
          : "Камера/микрофон недоступны: ") + (err?.message || String(err))
      );
    }
  };

  // Filter stations based on search query or tag searches
  const filteredRadioStations = stations.filter((station) => {
    const sQuery = searchQuery.trim().toLowerCase();
    const tQuery = tagQuery.trim().toLowerCase();
    
    const matchesKeyword = sQuery
      ? (station.name || '').toLowerCase().includes(sQuery) ||
        (station.state && String(station.state).toLowerCase().includes(sQuery)) ||
        (station.tags && String(station.tags).toLowerCase().includes(sQuery))
      : true;

    const matchesTag = tQuery
      ? station.tags && String(station.tags).toLowerCase().includes(tQuery)
      : true;

    return matchesKeyword && matchesTag;
  });

  const filteredYoutubeStations = youtubeStations.filter((station) => {
    const sQuery = searchQuery.trim().toLowerCase();
    if (!sQuery) return true;
    return (station.name || '').toLowerCase().includes(sQuery) ||
      (station.tags || '').toLowerCase().includes(sQuery) ||
      (station.state || '').toLowerCase().includes(sQuery);
  });

  const isCurrentlyLoading = loading || isProfileLoading || isYoutubeSearching;

  return (
    <div className="flex flex-col h-full bg-transparent gap-4">
      
      {/* Source Mode Selector Header Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-2 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-xs">
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <button
            onClick={() => setSourceMode("radio")}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              sourceMode === "radio"
                ? "bg-emerald-500 text-white shadow-sm"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{t("sources.radio")}</span>
          </button>
          
          <button
            onClick={() => setSourceMode("youtube")}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              sourceMode === "youtube"
                ? "bg-rose-600 text-white shadow-sm"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <Youtube className="w-3.5 h-3.5" />
            <span>{t("sources.youtube")}</span>
          </button>

          <button
            onClick={() => setSourceMode("media")}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              sourceMode === "media"
                ? "bg-violet-600 text-white shadow-sm"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{t("sources.media")}</span>
          </button>
        </div>

        {/* Quick Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={sourceMode === "radio" ? t("sources.filterRadio") : t("sources.filterYoutube")}
            className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </div>
      </div>

      {/* YouTube URL Custom Input Bar (Only visible in YouTube mode) */}
      {sourceMode === "youtube" && (
        <form onSubmit={handleAddCustomYouTubeUrl} className="flex flex-col sm:flex-row gap-2 bg-rose-500/5 dark:bg-rose-950/20 border border-rose-500/20 rounded-2xl p-3">
          <div className="flex-1 flex items-center gap-2">
            <Youtube className="w-4 h-4 text-rose-500 flex-shrink-0 ml-1" />
            <input
              type="text"
              value={youtubeUrlInput}
              onChange={(e) => setYoutubeUrlInput(e.target.value)}
              placeholder={t("sources.pasteUrl")}
              className="w-full bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
            />
          </div>
          <button
            type="submit"
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium transition-colors shadow-sm cursor-pointer flex-shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t("sources.loadTranslate")}</span>
          </button>
        </form>
      )}

      {/* YouTube Search Bar */}
      {sourceMode === "youtube" && (
        <form onSubmit={handleSearchYouTube} className="flex gap-2">
          <input
            type="text"
            value={youtubeSearchQuery}
            onChange={(e) => setYoutubeSearchQuery(e.target.value)}
            placeholder={t("sources.searchYoutube")}
            className="flex-1 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
          />
          <button
            type="submit"
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 dark:bg-slate-800 hover:bg-slate-900 text-white text-xs font-medium transition-colors cursor-pointer"
          >
            <Search className="w-3.5 h-3.5" />
            <span>{t("sources.searchBtn")}</span>
          </button>
        </form>
      )}

      {/* Local & Camera controls (only visible in media mode) */}
      {sourceMode === "media" && (
        <div className="flex flex-col sm:flex-row gap-2 bg-violet-500/5 dark:bg-violet-950/20 border border-violet-500/20 rounded-2xl p-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/*"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium transition-colors shadow-sm cursor-pointer flex-shrink-0"
          >
            <FileAudio className="w-3.5 h-3.5" />
            <span>{t("sources.uploadFile")}</span>
          </button>
          <button
            type="button"
            onClick={handleCameraCapture}
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 dark:bg-slate-800 text-white text-xs font-medium transition-colors shadow-sm cursor-pointer flex-shrink-0"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>{t("sources.captureCamera")}</span>
          </button>
          <p className="text-[10px] text-slate-400 self-center ml-1">
            Selected media becomes a playable source for live translation.
          </p>
        </div>
      )}

      {/* Header Label */}
      <div className="flex justify-between items-center px-1">
        <h3 className="font-display font-semibold text-slate-700 dark:text-slate-200 text-xs uppercase tracking-wider">
          {isCurrentlyLoading
            ? t("sources.scanning")
            : sourceMode === "radio"
            ? currentCountryProfile
              ? t("sources.regional", { country: currentCountryProfile.country })
              : t("sources.featured")
            : t("sources.youtubeSources")}
        </h3>
        <span className="text-[10px] text-slate-400 dark:text-slate-400 font-mono">
          {sourceMode === "radio" ? t("sources.activeStations", { count: filteredRadioStations.length }) : t("sources.youtubeCount", { count: filteredYoutubeStations.length })}
        </span>
      </div>

      {isCurrentlyLoading ? (
        /* Skeleton Grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 flex flex-col gap-3 animate-pulse h-[145px]"
            >
              <div className="flex gap-3 items-center">
                <div className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-800" />
                <div className="flex-1 flex flex-col gap-1.5">
                  <div className="h-3 w-3/4 bg-slate-200 dark:bg-slate-800 rounded" />
                  <div className="h-2.5 w-1/2 bg-slate-200 dark:bg-slate-800 rounded" />
                </div>
              </div>
              <div className="h-3 w-5/6 bg-slate-200 dark:bg-slate-800 rounded mt-auto" />
              <div className="flex justify-between items-center mt-2">
                <div className="h-2.5 w-12 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="h-6 w-16 bg-slate-200 dark:bg-slate-800 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : sourceMode === "media" ? (
        mediaStations.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {mediaStations.map((station) => {
              const isCurrent = activeStation?.stationuuid === station.stationuuid;
              return (
                <div
                  key={station.stationuuid}
                  onClick={() => onSelectStation(station)}
                  className={`p-4 rounded-2xl border transition-all duration-200 flex flex-col justify-between h-[150px] relative cursor-pointer group bg-white dark:bg-slate-900 shadow-xs ${
                    isCurrent
                      ? "border-violet-500 ring-1 ring-violet-500/20"
                      : "border-slate-200/60 dark:border-slate-800 hover:border-violet-300 dark:hover:border-violet-700 hover:shadow"
                  }`}
                >
                  <div className="flex gap-3 items-start">
                    <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/30 flex-shrink-0 flex items-center justify-center overflow-hidden border border-violet-200/40 dark:border-violet-900/40">
                      {station.isCamera ? <Camera className="w-5 h-5 text-violet-500" /> : <FileAudio className="w-5 h-5 text-violet-500" />}
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <h4 className="font-display font-bold text-xs text-slate-800 dark:text-slate-100 truncate">{station.name}</h4>
                      <span className="text-[10px] text-slate-400 truncate block mt-0.5">{station.isCamera ? "Camera / Microphone" : "Local file"}</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center border-t border-slate-100 dark:border-slate-800 pt-2 mt-2">
                    <span className="text-[9px] text-violet-500 font-mono uppercase tracking-wider">{station.isCamera ? "Live capture" : "Uploaded media"}</span>
                    <div className="p-1.5 rounded-full bg-slate-50 dark:bg-slate-950 text-violet-500 border border-slate-200/50 dark:border-slate-800 group-hover:bg-violet-600 group-hover:text-white transition-all">
                      {isCurrent && isPlaying ? <Volume2 className="w-3.5 h-3.5 animate-pulse" /> : <Play className="w-3.5 h-3.5 translate-x-[0.5px]" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-10 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center flex flex-col justify-center items-center gap-2">
            <Upload className="w-8 h-8 text-slate-300 dark:text-slate-700" />
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{t("sources.noMedia")}</p>
            <p className="text-[11px] text-slate-400">{t("sources.noMediaDesc")}</p>
          </div>
        )
      ) : sourceMode === "radio" ? (
        /* Radio Stations Grid */
        filteredRadioStations.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredRadioStations.map((station) => {
              const isCurrent = activeStation?.stationuuid === station.stationuuid;
              const tagsList = station.tags ? station.tags.split(",").slice(0, 3) : ["variety"];

              return (
                <div
                  key={station.stationuuid}
                  onClick={() => onSelectStation(station)}
                  className={`p-4 rounded-2xl border transition-all duration-200 flex flex-col justify-between h-[150px] relative cursor-pointer group bg-white dark:bg-slate-900 shadow-xs ${
                    isCurrent
                      ? "border-emerald-500 ring-1 ring-emerald-500/20"
                      : "border-slate-200/60 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow"
                  }`}
                  id={`station_card_${station.stationuuid}`}
                >
                  <div className="flex gap-3 items-start">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-950 flex-shrink-0 flex items-center justify-center overflow-hidden border border-slate-200/50 dark:border-slate-800">
                      {station.favicon ? (
                        <img
                          src={station.favicon}
                          alt=""
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = "none";
                          }}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Radio className="w-5 h-5 text-emerald-500" />
                      )}
                    </div>

                    <div className="flex-1 overflow-hidden">
                      <h4 className="font-display font-bold text-xs text-slate-800 dark:text-slate-100 truncate flex items-center gap-1 group-hover:text-emerald-500 transition-colors">
                        {station.name}
                        {station.votes > 8000 && (
                          <BadgeCheck className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                        )}
                      </h4>
                      <span className="text-[10px] text-slate-400 dark:text-slate-400 truncate block mt-0.5">
                        {station.state || "Regional Broadcast"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 mt-2.5 h-6 overflow-hidden">
                    {tagsList.map((tag, i) => (
                      <span
                        key={i}
                        className="text-[9px] font-mono px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded"
                      >
                        #{tag.trim()}
                      </span>
                    ))}
                  </div>

                  <div className="flex justify-between items-center border-t border-slate-100 dark:border-slate-800 pt-2 mt-2">
                    <div className="flex items-center gap-2.5 text-[9px] text-slate-400 font-mono uppercase tracking-wider">
                      <span>{station.codec || "MP3"}</span>
                      <span>•</span>
                      <span>{station.bitrate ? `${station.bitrate}kbps` : "128k"}</span>
                    </div>

                    <div className="p-1.5 rounded-full bg-slate-50 dark:bg-slate-950 text-emerald-500 border border-slate-200/50 dark:border-slate-800 group-hover:bg-emerald-500 group-hover:text-white transition-all">
                      {isCurrent && isPlaying ? (
                        <Volume2 className="w-3.5 h-3.5 animate-pulse" />
                      ) : (
                        <Play className="w-3.5 h-3.5 translate-x-[0.5px]" />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-10 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center flex flex-col justify-center items-center gap-2">
            <ShieldAlert className="w-8 h-8 text-slate-300 dark:text-slate-700" />
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{t("sources.noRadio")}</p>
            <p className="text-[11px] text-slate-400">{t("sources.noRadioDesc")}</p>
          </div>
        )
      ) : (
        /* YouTube Stations Grid */
        filteredYoutubeStations.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredYoutubeStations.map((station) => {
              const isCurrent = activeStation?.stationuuid === station.stationuuid;

              return (
                <div
                  key={station.stationuuid}
                  onClick={() => onSelectStation(station)}
                  className={`p-4 rounded-2xl border transition-all duration-200 flex flex-col justify-between h-[150px] relative cursor-pointer group bg-white dark:bg-slate-900 shadow-xs ${
                    isCurrent
                      ? "border-rose-500 ring-1 ring-rose-500/20"
                      : "border-slate-200/60 dark:border-slate-800 hover:border-rose-300 dark:hover:border-rose-700 hover:shadow"
                  }`}
                >
                  <div className="flex gap-3 items-start">
                    <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/30 flex-shrink-0 flex items-center justify-center overflow-hidden border border-rose-200/40 dark:border-rose-900/40">
                      {station.favicon ? (
                        <img
                          src={station.favicon}
                          alt=""
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = "none";
                          }}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Youtube className="w-5 h-5 text-rose-500" />
                      )}
                    </div>

                    <div className="flex-1 overflow-hidden">
                      <h4 className="font-display font-bold text-xs text-slate-800 dark:text-slate-100 truncate flex items-center gap-1 group-hover:text-rose-500 transition-colors">
                        {station.name}
                      </h4>
                      <span className="text-[10px] text-slate-400 dark:text-slate-400 truncate block mt-0.5">
                        {station.state || "YouTube Stream"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 mt-2.5 h-6 overflow-hidden">
                    <span className="text-[9px] font-mono px-1.5 py-0.5 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded">
                      #YouTubeLive
                    </span>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded">
                      #AudioTranslate
                    </span>
                  </div>

                  <div className="flex justify-between items-center border-t border-slate-100 dark:border-slate-800 pt-2 mt-2">
                    <div className="flex items-center gap-2.5 text-[9px] text-rose-500 dark:text-rose-400 font-mono uppercase tracking-wider">
                      <span>YouTube Stream</span>
                    </div>

                    <div className="p-1.5 rounded-full bg-slate-50 dark:bg-slate-950 text-rose-500 border border-slate-200/50 dark:border-slate-800 group-hover:bg-rose-600 group-hover:text-white transition-all">
                      {isCurrent && isPlaying ? (
                        <Volume2 className="w-3.5 h-3.5 animate-pulse" />
                      ) : (
                        <Play className="w-3.5 h-3.5 translate-x-[0.5px]" />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-10 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center flex flex-col justify-center items-center gap-2">
            <ShieldAlert className="w-8 h-8 text-slate-300 dark:text-slate-700" />
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{t("sources.noYoutube")}</p>
            <p className="text-[11px] text-slate-400">{t("sources.noYoutubeDesc")}</p>
          </div>
        )
      )}
    </div>
  );
}
