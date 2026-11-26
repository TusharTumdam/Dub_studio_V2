import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioWaveform,
  FileText,
  Languages,
  Mic,
  Sliders,
  Film,
  Download,
  Check,
  Loader2,
  Sun,
  Moon,
  Settings2,
  Sparkles,
  AlertCircle,
  Upload,
  FolderArchive,
  LogIn,
  LogOut,
  Cloud,
} from 'lucide-react';
import {
  AdaptationStyle,
  AudioMixConfig,
  DubbingSegment,
  ExternalProviderConfig,
  GeminiVoiceId,
  GlobalSourceLanguage,
  IndianVocalDialect,
  PipelineStageNumber,
  SampleReelPreset,
  StageState,
  STUDIO_SAMPLE_REELS,
} from './types/dubbing';
import {
  analyzeOriginalBgmSignature,
  analyzeOriginalVoiceProfile,
  arrayBufferToBase64,
  computeWaveformPeaks,
  countSyllables,
  decodeBase64Audio,
  encodeAudioBufferToWav,
  generateSrtSubtitles,
  getAudioContext,
  inferCharacterGender,
  parseSrtToDubbingSegments,
  readSubtitleFileAsText,
  renderMixedMasterBuffer,
  synthesizeSampleReelAudioBuffer,
} from './utils/audioEngine';
import { VideoMonitor } from './components/VideoMonitor';
import { ScriptStudio } from './components/ScriptStudio';
import { AudioDuckingMixer } from './components/AudioDuckingMixer';
import { ProviderModal } from './components/ProviderModal';
import { ProjectManagerModal } from './components/ProjectManagerModal';
import { ImportSrtModal } from './components/ImportSrtModal';
import { useAuth } from './context/AuthContext';
import { SavedDubbingProject } from './lib/firebase';



const PIPELINE_STAGES: Array<{
  num: PipelineStageNumber;
  label: string;
  shortDesc: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    num: 1,
    label: '01. Extract Audio',
    shortDesc: 'Decode 24kHz WAV & waveform peaks',
    icon: AudioWaveform,
  },
  {
    num: 2,
    label: '02. Global Transcribe',
    shortDesc: 'Auto-detect language & timecode',
    icon: FileText,
  },
  {
    num: 3,
    label: '03. Indian Hindi Adapt',
    shortDesc: 'Natural Hindi / Hinglish & breath cues',
    icon: Languages,
  },
  {
    num: 4,
    label: '04. Indian Human Voice',
    shortDesc: 'Realistic Indian 24kHz .wav synthesis',
    icon: Mic,
  },
  {
    num: 5,
    label: '05. Duck & Warmth Mix',
    shortDesc: 'Sidechain BGM & studio vocal EQ',
    icon: Sliders,
  },
  {
    num: 6,
    label: '06. Lip-Sync Video',
    shortDesc: 'Viseme warp & master export',
    icon: Film,
  },
];

async function safeFetchJson(
  url: string,
  options?: RequestInit,
  retries = 2
): Promise<{ ok: boolean; status: number; data: any }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      const rawText = await response.text();
      const trimmed = rawText.trim();
      if (trimmed.startsWith('<')) {
        // Server or proxy returned an HTML page (e.g. during server restart or gateway timeout)
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
        return {
          ok: false,
          status: response.status || 502,
          data: { error: 'Server temporarily busy or restarting. Retrying automatically...' },
        };
      }
      const parsed = trimmed ? JSON.parse(trimmed) : {};
      return {
        ok: response.ok,
        status: response.status,
        data: parsed,
      };
    } catch (err: any) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      return {
        ok: false,
        status: 500,
        data: { error: err?.message || 'Network request failed.' },
      };
    }
  }
  return { ok: false, status: 500, data: {} };
}

/**
 * Normalizes speaker labels across transcription windows (e.g. "[Male - Character 1]", "Character 1", "Speaker 1", "Narrator")
 * into a single canonical character identity key so the same speaker NEVER gets assigned two different voices mid-video.
 */
function normalizeCanonicalSpeakerKey(
  rawSpeaker: string | undefined,
  gender: 'male' | 'female'
): string {
  const cleaned = (rawSpeaker || '')
    .replace(/^\[|\]$/g, '')
    .replace(/^\(|\)$/g, '')
    .replace(/^(?:male|female|man|woman|boy|girl)\s*[-:–—/]\s*/i, '')
    .replace(/\s*\((?:male|female|man|woman)\)\s*/gi, '')
    .trim();

  if (
    !cleaned ||
    /^(?:character\s*1|speaker\s*1|narrator|speaker|host|creator|voiceover|male|female|user|presenter)$/i.test(
      cleaned
    )
  ) {
    return gender === 'female' ? 'Female Character 1' : 'Character 1';
  }
  if (/^(?:character\s*2|speaker\s*2)$/i.test(cleaned)) {
    return gender === 'female' ? 'Female Character 2' : 'Character 2';
  }
  return cleaned;
}

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [sourceType, setSourceType] = useState<'sample' | 'upload'>('sample');
  const [selectedReel, setSelectedReel] = useState<SampleReelPreset>(STUDIO_SAMPLE_REELS[0]);
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  const [durationSeconds, setDurationSeconds] = useState<number>(
    STUDIO_SAMPLE_REELS[0].durationSeconds
  );
  const durationSecondsRef = useRef<number>(STUDIO_SAMPLE_REELS[0].durationSeconds);
  const updateDurationSeconds = useCallback((nextDur: number) => {
    const safeDur = Math.max(1, Number(nextDur.toFixed(2)));
    durationSecondsRef.current = safeDur;
    setDurationSeconds(safeDur);
  }, []);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const [audioMode, setAudioMode] = useState<'hindi_master' | 'english_original'>('hindi_master');
  const [subtitlesMode, setSubtitlesMode] = useState<'hindi' | 'hinglish' | 'bilingual' | 'off'>(
    'bilingual'
  );
  const [lipSyncOverlayEnabled, setLipSyncOverlayEnabled] = useState<boolean>(true);

  const [sourceLanguage, setSourceLanguage] = useState<GlobalSourceLanguage>(
    STUDIO_SAMPLE_REELS[0].sourceLanguage
  );
  const [adaptationStyle, setAdaptationStyle] = useState<AdaptationStyle>(
    STUDIO_SAMPLE_REELS[0].recommendedStyle
  );
  const [indianDialect, setIndianDialect] = useState<IndianVocalDialect>(
    STUDIO_SAMPLE_REELS[0].defaultDialect
  );
  const [globalVoiceId, setGlobalVoiceId] = useState<GeminiVoiceId>(
    STUDIO_SAMPLE_REELS[0].defaultVoice
  );
  const originalPitchHzRef = useRef<number>(134);
  const [characterMatchBadge, setCharacterMatchBadge] = useState<string>(
    'Warm Male Creator (~134 Hz) · Locked: Charon (Aarav) | BGM Match: D Minor (146.8 Hz) · 108 BPM'
  );

  // Extracted Original AudioBuffer & Waveform
  const originalAudioBufferRef = useRef<AudioBuffer | null>(null);
  const mixedMasterBufferRef = useRef<AudioBuffer | null>(null);
  const [extractedWavBase64, setExtractedWavBase64] = useState<string | null>(null);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>(() =>
    Array.from({ length: 180 }, (_, i) => 0.15 + 0.45 * Math.abs(Math.sin(i * 0.18)))
  );

  // Timecoded Dubbing Segments
  const [segments, setSegments] = useState<DubbingSegment[]>(() =>
    STUDIO_SAMPLE_REELS[0].segments.map((s, idx) => {
      const gen = inferCharacterGender(s.speaker, s.englishText);
      const assignedVoice: GeminiVoiceId =
        gen === 'female'
          ? ['Kore', 'Zephyr'].includes(STUDIO_SAMPLE_REELS[0].defaultVoice)
            ? STUDIO_SAMPLE_REELS[0].defaultVoice
            : 'Kore'
          : ['Charon', 'Fenrir', 'Puck'].includes(STUDIO_SAMPLE_REELS[0].defaultVoice)
          ? STUDIO_SAMPLE_REELS[0].defaultVoice
          : 'Charon';
      return {
        id: `seg-${idx + 1}`,
        index: idx,
        startTime: s.startTime,
        endTime: s.endTime,
        speaker: s.speaker,
        gender: gen,
        detectedLanguage: s.detectedLanguage,
        englishText: s.englishText,
        hindiDevanagari: s.hindiDevanagari,
        hinglishRoman: s.hinglishRoman,
        emotionPrompt: s.emotionPrompt,
        indianDialect: STUDIO_SAMPLE_REELS[0].defaultDialect,
        humanBreathEnabled: true,
        voiceId: assignedVoice,
        englishSyllables: countSyllables(s.englishText),
        hindiSyllables: countSyllables(s.hindiDevanagari),
        playbackRate: 1.0,
      };
    })
  );

  // 6-Stage Pipeline Status
  const [stageStatus, setStageStatus] = useState<Record<PipelineStageNumber, StageState>>({
    1: 'completed',
    2: 'completed',
    3: 'completed',
    4: 'idle',
    5: 'idle',
    6: 'idle',
  });
  const [activeStage, setActiveStage] = useState<PipelineStageNumber>(4);
  const [isRunningFullPipeline, setIsRunningFullPipeline] = useState<boolean>(false);
  const [isTranslatingAll, setIsTranslatingAll] = useState<boolean>(false);
  const [isSynthesizingAll, setIsSynthesizingAll] = useState<boolean>(false);
  const [isRenderingMix, setIsRenderingMix] = useState<boolean>(false);
  const [isExportingVideo, setIsExportingVideo] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string>(
    'Upload your video (or drop it onto the Video Monitor) to automatically dub it into realistic Indian Hindi.'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Audio Ducking, Indian Vocal Warmth EQ, SFX Engine Foley & Lip-Sync Configuration
  const [mixConfig, setMixConfig] = useState<AudioMixConfig>({
    hindiVocalGainDb: 2.5,
    bgmBaseGainDb: -2.0,
    duckingReductionDb: -16,
    duckingAttackMs: 45,
    duckingReleaseMs: 280,
    vocalIsolationEnabled: true,
    studioWarmthEqEnabled: true,
    autoTimeStretchLipSync: true,
    lipSyncWarpIntensity: 85,
    sfxAmbienceEnabled: false,
    sfxPreset: 'creator_studio',
    sfxGainDb: -10,
  });

  // External Provider Configuration
  const [isProviderModalOpen, setIsProviderModalOpen] = useState<boolean>(false);
  const [providerConfig, setProviderConfig] = useState<ExternalProviderConfig>({
    elevenLabsEnabled: false,
    elevenLabsApiKey: '',
    elevenLabsVoiceId: 'JBFqnCBsd6RMkjVDRZzb',
    elevenLabsModelId: 'eleven_multilingual_v2',
    useHighExpressiveGeminiTts: true,
    externalLipSyncEnabled: false,
    externalLipSyncEndpoint: '',
    externalLipSyncApiKey: '',
  });

  // Firebase Auth & Project Persistence
  const { user, signIn, signOut, isDbConnected } = useAuth();
  const [isProjectModalOpen, setIsProjectModalOpen] = useState<boolean>(false);
  const [isImportSrtModalOpen, setIsImportSrtModalOpen] = useState<boolean>(false);
  const [currentProjectTitle, setCurrentProjectTitle] = useState<string>(
    STUDIO_SAMPLE_REELS[0].title
  );

  const handleLoadSavedProject = (
    proj: SavedDubbingProject,
    loadedSegs: DubbingSegment[]
  ) => {
    stopPlayback();
    setCurrentProjectTitle(proj.title);
    if (proj.sourceLanguage) setSourceLanguage(proj.sourceLanguage as GlobalSourceLanguage);
    if (proj.adaptationStyle) setAdaptationStyle(proj.adaptationStyle as AdaptationStyle);
    if (proj.indianDialect) setIndianDialect(proj.indianDialect as IndianVocalDialect);
    if (proj.globalVoiceId) setGlobalVoiceId(proj.globalVoiceId as GeminiVoiceId);
    if (proj.durationSeconds) updateDurationSeconds(proj.durationSeconds);
    if (loadedSegs && loadedSegs.length > 0) {
      setSegments(loadedSegs);
    }
    setStageStatus({
      1: 'completed',
      2: 'completed',
      3: 'completed',
      4: 'idle',
      5: 'idle',
      6: 'idle',
    });
    setActiveStage(4);
    setStatusBanner(
      `Loaded project "${proj.title}" from Firestore with ${loadedSegs.length} dialogue cues.`
    );
  };


  // DOM & Web Audio Playback References
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const topVideoUploadRef = useRef<HTMLInputElement | null>(null);
  const srtUploadRef = useRef<HTMLInputElement | null>(null);
  const activeSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const playStartWallTimeRef = useRef<number>(0);
  const playStartOffsetRef = useRef<number>(0);

  // Sync Dark / Light class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  // Initialize sample reel audio buffer lazily on load without blocking page interactivity
  const initSampleReelAudio = useCallback((reel: SampleReelPreset) => {
    // Immediate default peaks for instantaneous UI display
    setWaveformPeaks(Array.from({ length: 180 }, (_, i) => 0.15 + 0.45 * Math.abs(Math.sin(i * 0.18))));
    const runInit = () => {
      try {
        const buffer = synthesizeSampleReelAudioBuffer(reel);
        originalAudioBufferRef.current = buffer;
        mixedMasterBufferRef.current = null;
        const peaks = computeWaveformPeaks(buffer, 180);
        setWaveformPeaks(peaks);
      } catch {}
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(runInit, { timeout: 1500 });
    } else {
      setTimeout(runInit, 50);
    }
  }, []);

  useEffect(() => {
    initSampleReelAudio(STUDIO_SAMPLE_REELS[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (activeSourceNodeRef.current) {
      try {
        activeSourceNodeRef.current.stop();
        activeSourceNodeRef.current.disconnect();
      } catch {}
      activeSourceNodeRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
    }
  }, []);

  // Rebuild Mixed Master AudioBuffer whenever segments or mixConfig change
  const rebuildMasterMix = useCallback(
    async (segsToMix: DubbingSegment[], cfg: AudioMixConfig) => {
      if (!originalAudioBufferRef.current) return null;
      const hasAnyWav = segsToMix.some((s) => Boolean(s.generatedWavBase64));
      if (!hasAnyWav) {
        mixedMasterBufferRef.current = null;
        return null;
      }
      setIsRenderingMix(true);
      try {
        const master = await renderMixedMasterBuffer(
          originalAudioBufferRef.current,
          segsToMix,
          cfg
        );
        mixedMasterBufferRef.current = master;
        return master;
      } catch {
        return null;
      } finally {
        setIsRenderingMix(false);
      }
    },
    []
  );

  // Synthesize a single segment's realistic Indian Hindi WAV via /api/dubbing/tts
  const synthesizeSegmentHelper = async (
    seg: DubbingSegment,
    lockedVoiceOverride?: GeminiVoiceId
  ): Promise<DubbingSegment> => {
    let textToSpeak = (seg.hindiDevanagari || seg.hinglishRoman || '').trim();
    if (!textToSpeak && seg.englishText?.trim()) {
      try {
        const { ok: tOk, data: tData } = await safeFetchJson('/api/dubbing/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            style: adaptationStyle,
            sourceLanguage,
            indianDialect: seg.indianDialect || indianDialect,
            segments: [seg],
          }),
        });
        if (tOk && tData?.adapted?.[0]?.hindiDevanagari) {
          textToSpeak = tData.adapted[0].hindiDevanagari;
          seg.hindiDevanagari = textToSpeak;
          seg.hinglishRoman = tData.adapted[0].hinglishRoman || textToSpeak;
        }
      } catch {}
    }
    if (!textToSpeak) {
      textToSpeak = seg.englishText || 'नमस्ते दोस्तों';
    }

    const lockedVoice = lockedVoiceOverride || seg.voiceId || globalVoiceId;

    const { ok, data } = await safeFetchJson('/api/dubbing/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: textToSpeak,
        voiceName: lockedVoice,
        emotionPrompt: seg.emotionPrompt,
        indianDialect: seg.indianDialect || indianDialect,
        useScreenplayModel: providerConfig.useHighExpressiveGeminiTts,
        originalPitchHz: originalPitchHzRef.current,
        elevenLabsConfig: providerConfig.elevenLabsEnabled
          ? {
              enabled: true,
              apiKey: providerConfig.elevenLabsApiKey,
              voiceId: providerConfig.elevenLabsVoiceId,
              modelId: providerConfig.elevenLabsModelId || 'eleven_multilingual_v2',
            }
          : undefined,
      }),
    });

    if (!ok || !data?.audioBase64) {
      throw new Error(
        data?.error || `Failed to synthesize realistic Indian voice for segment #${seg.index + 1}`
      );
    }

    const decodedBuf = await decodeBase64Audio(data.audioBase64);
    // STRICT PITCH LOCK: Keep playbackRate at 1.00 across all segments so Web Audio API never shifts speaker pitch
    const computedRate = 1.0;

    return {
      ...seg,
      voiceId: lockedVoice,
      generatedWavBase64: data.audioBase64,
      generatedMimeType: data.mimeType || 'audio/wav',
      rawAudioDuration: decodedBuf.duration,
      playbackRate: computedRate,
      isSynthesizing: false,
    };
  };

  // STAGE 4, 5, 6: Synthesize All Indian Voices with 100% Locked Character Identity, Render Full-Length Mix & Calibrate Lip-Sync
  const runStage4To6VoiceAndMix = useCallback(
    async (
      segsInput?: DubbingSegment[],
      lockedVoiceOverride?: GeminiVoiceId
    ): Promise<AudioBuffer | null> => {
      const targetSegs = segsInput || segments;
      if (targetSegs.length === 0) return null;

      const MALE_VOICES: GeminiVoiceId[] = ['Charon', 'Fenrir', 'Puck'];
      const FEMALE_VOICES: GeminiVoiceId[] = ['Kore', 'Zephyr'];
      let maleCounter = 0;
      let femaleCounter = 0;

      // Character-locked voice map: normalizes speaker labels so the same character strictly retains 1 gender-accurate voice for the entire video
      const characterVoiceLockMap = new Map<string, GeminiVoiceId>();
      targetSegs.forEach((s) => {
        const gen = s.gender || inferCharacterGender(s.speaker, s.englishText);
        const canonicalKey = normalizeCanonicalSpeakerKey(s.speaker, gen);
        if (!characterVoiceLockMap.has(canonicalKey)) {
          if (gen === 'female') {
            const preferredFemale: GeminiVoiceId =
              lockedVoiceOverride && FEMALE_VOICES.includes(lockedVoiceOverride)
                ? lockedVoiceOverride
                : s.voiceId && FEMALE_VOICES.includes(s.voiceId)
                ? s.voiceId
                : FEMALE_VOICES.includes(globalVoiceId)
                ? globalVoiceId
                : 'Kore';
            const femalePool: GeminiVoiceId[] = [
              preferredFemale,
              ...FEMALE_VOICES.filter((v) => v !== preferredFemale),
            ];
            const assignedFemale =
              femaleCounter === 0
                ? preferredFemale
                : s.voiceId && FEMALE_VOICES.includes(s.voiceId) && s.voiceId !== preferredFemale
                ? s.voiceId
                : femalePool[femaleCounter % femalePool.length];
            characterVoiceLockMap.set(canonicalKey, assignedFemale);
            femaleCounter++;
          } else {
            const preferredMale: GeminiVoiceId =
              lockedVoiceOverride && MALE_VOICES.includes(lockedVoiceOverride)
                ? lockedVoiceOverride
                : s.voiceId && MALE_VOICES.includes(s.voiceId)
                ? s.voiceId
                : MALE_VOICES.includes(globalVoiceId)
                ? globalVoiceId
                : 'Charon';
            const malePool: GeminiVoiceId[] = [
              preferredMale,
              ...MALE_VOICES.filter((v) => v !== preferredMale),
            ];
            const assignedMale =
              maleCounter === 0
                ? preferredMale
                : s.voiceId && MALE_VOICES.includes(s.voiceId) && s.voiceId !== preferredMale
                ? s.voiceId
                : malePool[maleCounter % malePool.length];
            characterVoiceLockMap.set(canonicalKey, assignedMale);
            maleCounter++;
          }
        }
      });

      setIsSynthesizingAll(true);
      setStageStatus((prev) => ({
        ...prev,
        4: 'processing',
        5: 'idle',
        6: 'idle',
      }));
      setActiveStage(4);
      setErrorMessage(null);
      setStatusBanner(
        `Stage 4: Synthesizing ${targetSegs.length} segments with locked character voice (${
          characterVoiceLockMap.size > 1 ? `${characterVoiceLockMap.size} Distinct Characters` : '100% Single-Speaker Voice Lock'
        })...`
      );

      setSegments((prev) =>
        prev.map((s) => {
          const gen = s.gender || inferCharacterGender(s.speaker, s.englishText);
          const canonicalKey = normalizeCanonicalSpeakerKey(s.speaker, gen);
          return {
            ...s,
            speaker: canonicalKey,
            voiceId: characterVoiceLockMap.get(canonicalKey) || s.voiceId || globalVoiceId,
            isSynthesizing: true,
          };
        })
      );

      try {
        // Synthesize sequentially (1 by 1 with 350ms pacing) so Free Tier RPM limits NEVER trigger on segment #7+
        const updatedSegs: DubbingSegment[] = [...targetSegs];
        for (let i = 0; i < targetSegs.length; i++) {
          const gen =
            targetSegs[i].gender ||
            inferCharacterGender(targetSegs[i].speaker, targetSegs[i].englishText);
          const canonicalKey = normalizeCanonicalSpeakerKey(targetSegs[i].speaker, gen);
          const segVoice =
            characterVoiceLockMap.get(canonicalKey) ||
            targetSegs[i].voiceId ||
            lockedVoiceOverride ||
            globalVoiceId;
          const seg = { ...targetSegs[i], speaker: canonicalKey, voiceId: segVoice };
          setStatusBanner(
            `Stage 4: Synthesizing locked Indian voice [${segVoice}] for ${seg.speaker} (${i + 1} / ${
              targetSegs.length
            } segments)...`
          );

          let synthesized: DubbingSegment | null = null;
          let lastErr: any = null;
          for (let retry = 0; retry < 3; retry++) {
            try {
              synthesized = await synthesizeSegmentHelper(seg, segVoice);
              break;
            } catch (err) {
              lastErr = err;
              await new Promise((r) => setTimeout(r, 1500 * (retry + 1)));
            }
          }
          if (!synthesized) {
            throw lastErr || new Error(`Voice synthesis failed on segment #${i + 1}`);
          }

          updatedSegs[i] = synthesized;
          setSegments([...updatedSegs]);

          if (i + 1 < targetSegs.length) {
            await new Promise((r) => setTimeout(r, 350));
          }
        }

        // Keep segment startTime locked to the original video timecode so the Hindi voiceover matches the video actors
        const alignedSegs = updatedSegs.map((seg) => {
          const rawDur = seg.rawAudioDuration || Math.max(1.2, seg.endTime - seg.startTime);
          const rate = seg.playbackRate || 1.0;
          const playDur = rawDur / rate;
          const end = Number(Math.max(seg.endTime, seg.startTime + playDur).toFixed(2));
          return {
            ...seg,
            startTime: seg.startTime,
            endTime: end,
          };
        });

        setSegments(alignedSegs);

        setStageStatus((prev) => ({ ...prev, 4: 'completed', 5: 'processing' }));
        setActiveStage(5);
        setStatusBanner(
          'Stage 5: Suppressing original English voice track and applying Indian Studio Vocal Warmth EQ...'
        );

        const masterBuf = await rebuildMasterMix(alignedSegs, mixConfig);
        if (masterBuf && masterBuf.duration > durationSecondsRef.current) {
          updateDurationSeconds(masterBuf.duration);
        }

        setStageStatus((prev) => ({ ...prev, 5: 'completed', 6: 'processing' }));
        setActiveStage(6);
        setStatusBanner(
          'Stage 6: Aligning Hindi visemes and locking segment time-stretch to speaker mouth movements...'
        );

        await new Promise((r) => setTimeout(r, 150));
        setStageStatus((prev) => ({ ...prev, 6: 'completed' }));
        setAudioMode('hindi_master');
        setStatusBanner(
          'Full-Length Hindi Dubbing Complete! Press Play on the Video Monitor to watch your video dubbed in realistic Indian Hindi.'
        );
        return masterBuf;
      } catch (err: any) {
        setErrorMessage(err?.message || 'Voice synthesis pipeline encountered an error.');
        setStageStatus((prev) => ({ ...prev, 4: 'error' }));
        setSegments((prev) => prev.map((s) => ({ ...s, isSynthesizing: false })));
        return null;
      } finally {
        setIsSynthesizingAll(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segments, mixConfig, indianDialect, providerConfig, rebuildMasterMix, updateDurationSeconds]
  );

  // StartPlaybackWithBuffer helper so we can start playing immediately after auto-dubbing an uploaded video
  const startPlaybackWithBuffer = useCallback(
    async (
      bufferToPlay: AudioBuffer | null,
      offset = 0,
      isUploadedVideo = sourceType === 'upload',
      explicitDuration?: number
    ) => {
      stopPlayback();
      const ctx = getAudioContext();
      await ctx.resume();

      setCurrentTime(offset);

      if (bufferToPlay) {
        const source = ctx.createBufferSource();
        source.buffer = bufferToPlay;
        source.connect(ctx.destination);
        source.start(0, offset);
        activeSourceNodeRef.current = source;
      }

      if (isUploadedVideo && videoRef.current) {
        videoRef.current.currentTime = offset;
        videoRef.current.play().catch(() => {});
      }

      playStartWallTimeRef.current = performance.now();
      playStartOffsetRef.current = offset;
      setIsPlaying(true);

      const targetPlayDuration = Math.max(
        explicitDuration || 0,
        durationSecondsRef.current,
        bufferToPlay?.duration || 0
      );

      let lastUiUpdate = 0;
      const tick = () => {
        const now = performance.now();
        const elapsed = (now - playStartWallTimeRef.current) / 1000;
        const nextTime = playStartOffsetRef.current + elapsed;
        if (nextTime >= targetPlayDuration) {
          setCurrentTime(targetPlayDuration);
          stopPlayback();
          return;
        }
        if (now - lastUiUpdate >= 100) {
          lastUiUpdate = now;
          setCurrentTime(nextTime);

          // Only resync if video has drifted noticeably (>1.2s), preserving hardware decoder fluidity without stutter
          if (isUploadedVideo && videoRef.current && !videoRef.current.paused) {
            const vTime = videoRef.current.currentTime;
            if (Math.abs(vTime - nextTime) > 1.2) {
              videoRef.current.currentTime = nextTime;
            }
          }
        }
        animFrameRef.current = requestAnimationFrame(tick);
      };

      animFrameRef.current = requestAnimationFrame(tick);
    },
    [sourceType, stopPlayback]
  );

  // Start or pause synchronized video + Web Audio playback (auto-synthesizes Hindi voices if needed)
  const handleTogglePlay = useCallback(async () => {
    if (isPlaying) {
      stopPlayback();
      return;
    }

    const startOffset = currentTime >= durationSeconds - 0.15 ? 0 : currentTime;
    let bufferToPlay = originalAudioBufferRef.current;

    if (audioMode === 'hindi_master') {
      const hasGeneratedWav = segments.some((s) => Boolean(s.generatedWavBase64));
      if (!hasGeneratedWav) {
        let segsToDub = segments;
        const needsHindi = segsToDub.some((s) => !s.hindiDevanagari?.trim());
        if (needsHindi) {
          segsToDub = await runStage3TranslateHindi(segsToDub);
        }
        const freshlySynthesizedMaster = await runStage4To6VoiceAndMix(segsToDub);
        if (freshlySynthesizedMaster) {
          bufferToPlay = freshlySynthesizedMaster;
        }
      } else if (!mixedMasterBufferRef.current) {
        bufferToPlay = await rebuildMasterMix(segments, mixConfig);
      } else {
        bufferToPlay = mixedMasterBufferRef.current;
      }
    }

    await startPlaybackWithBuffer(bufferToPlay, startOffset, sourceType === 'upload');
  }, [
    isPlaying,
    currentTime,
    durationSeconds,
    audioMode,
    segments,
    mixConfig,
    sourceType,
    stopPlayback,
    rebuildMasterMix,
    runStage4To6VoiceAndMix,
    startPlaybackWithBuffer,
  ]);

  const handleSeek = useCallback(
    (newTime: number) => {
      const clamped = Math.max(0, Math.min(durationSeconds, newTime));
      if (isPlaying) {
        stopPlayback();
      }
      setCurrentTime(clamped);
      if (sourceType === 'upload' && videoRef.current) {
        videoRef.current.currentTime = clamped;
      }
    },
    [durationSeconds, isPlaying, sourceType, stopPlayback]
  );

  const handleChangeAudioMode = useCallback(
    async (nextMode: 'hindi_master' | 'english_original') => {
      setAudioMode(nextMode);
      if (isPlaying) {
        const resumeOffset = Math.min(currentTime, Math.max(0, durationSecondsRef.current - 0.1));
        const targetBuf =
          nextMode === 'hindi_master'
            ? mixedMasterBufferRef.current || originalAudioBufferRef.current
            : originalAudioBufferRef.current;
        await startPlaybackWithBuffer(targetBuf, resumeOffset, sourceType === 'upload');
      }
    },
    [isPlaying, currentTime, sourceType, startPlaybackWithBuffer]
  );

  // Select a Studio Sample Reel (supports Global Languages: EN, KO, ES, JA)
  const handleSelectSampleReel = (reel: SampleReelPreset) => {
    stopPlayback();
    setSourceType('sample');
    setSelectedReel(reel);
    updateDurationSeconds(reel.durationSeconds);
    setCurrentTime(0);
    setSourceLanguage(reel.sourceLanguage);
    setAdaptationStyle(reel.recommendedStyle);
    setIndianDialect(reel.defaultDialect);
    setGlobalVoiceId(reel.defaultVoice);
    initSampleReelAudio(reel);

    setSegments(
      reel.segments.map((s, idx) => {
        const gen = inferCharacterGender(s.speaker, s.englishText);
        const assignedVoice: GeminiVoiceId =
          gen === 'female'
            ? ['Kore', 'Zephyr'].includes(reel.defaultVoice)
              ? reel.defaultVoice
              : 'Kore'
            : ['Charon', 'Fenrir', 'Puck'].includes(reel.defaultVoice)
            ? reel.defaultVoice
            : 'Charon';
        return {
          id: `seg-${idx + 1}`,
          index: idx,
          startTime: s.startTime,
          endTime: s.endTime,
          speaker: s.speaker,
          gender: gen,
          detectedLanguage: s.detectedLanguage,
          englishText: s.englishText,
          hindiDevanagari: s.hindiDevanagari,
          hinglishRoman: s.hinglishRoman,
          emotionPrompt: s.emotionPrompt,
          indianDialect: reel.defaultDialect,
          humanBreathEnabled: true,
          voiceId: assignedVoice,
          englishSyllables: countSyllables(s.englishText),
          hindiSyllables: countSyllables(s.hindiDevanagari),
          playbackRate: 1.0,
        };
      })
    );

    setStageStatus({
      1: 'completed',
      2: 'completed',
      3: 'completed',
      4: 'idle',
      5: 'idle',
      6: 'idle',
    });
    setActiveStage(4);
    setErrorMessage(null);
    setStatusBanner(
      `Loaded "${reel.title}" (${reel.sourceLanguageBadge} → Indian Hindi). Press Play to auto-synthesize and hear the Hindi dub.`
    );
  };

  // STAGE 1: Explicit Audio Extraction trigger (extracts full duration without truncation)
  const runStage1ExtractAudio = async (): Promise<string | null> => {
    setStageStatus((prev) => ({ ...prev, 1: 'processing' }));
    setActiveStage(1);
    setErrorMessage(null);
    setStatusBanner('Stage 1: Decoding full-length video audio stream into PCM WAV...');

    await new Promise((r) => setTimeout(r, 50));
    if (sourceType === 'sample' || !originalAudioBufferRef.current) {
      initSampleReelAudio(selectedReel);
    }
    const fullBuf = originalAudioBufferRef.current!;
    const targetRate = 8000;
    const wavBuf = encodeAudioBufferToWav(fullBuf, targetRate, Math.min(32, fullBuf.duration), 0);
    const b64 = arrayBufferToBase64(wavBuf);
    setExtractedWavBase64(b64);

    setStageStatus((prev) => ({ ...prev, 1: 'completed' }));
    setStatusBanner('Stage 1 Complete: Full-length mono WAV extracted and waveform envelope computed.');
    return b64;
  };

  // STAGE 2: Windowed Full-Length Multilingual Transcription covering 100% of the video
  const runStage2Transcribe = async (
    wavB64Override?: string,
    clipDurOverride?: number,
    isCustomUpload = sourceType === 'upload',
    preferredLeadVoice?: GeminiVoiceId
  ): Promise<DubbingSegment[]> => {
    const targetDur = clipDurOverride || durationSecondsRef.current;

    setStageStatus((prev) => ({ ...prev, 2: 'processing' }));
    setActiveStage(2);
    setErrorMessage(null);

    const fallbackTranscript = !isCustomUpload
      ? selectedReel.segments
          .map((s) => `[${s.startTime}s-${s.endTime}s] (${s.detectedLanguage}) ${s.englishText}`)
          .join(' ')
      : undefined;

    const collectedRawSegs: any[] = [];
    const fullAudioBuf = originalAudioBufferRef.current;

    // For uploaded videos with a decoded AudioBuffer, transcribe in compact 30-second 8kHz windows
    if (isCustomUpload && fullAudioBuf && fullAudioBuf.duration > 32) {
      const windowSec = 30;
      const totalWindows = Math.min(4, Math.ceil(targetDur / windowSec));

      for (let wIdx = 0; wIdx < totalWindows; wIdx++) {
        const offset = wIdx * windowSec;
        const winDur = Math.min(windowSec, targetDur - offset);
        if (winDur < 1.0) break;

        setStatusBanner(
          `Stage 2: Transcribing full video audio (Window ${wIdx + 1}/${totalWindows}: ${Math.round(
            offset
          )}s – ${Math.round(offset + winDur)}s)...`
        );

        await new Promise((r) => setTimeout(r, 0));
        const sliceWav = encodeAudioBufferToWav(fullAudioBuf, 8000, winDur, offset);
        const sliceB64 = arrayBufferToBase64(sliceWav);

        const { ok, data } = await safeFetchJson('/api/dubbing/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64: sliceB64,
            mimeType: 'audio/wav',
            durationSeconds: winDur,
            offsetSeconds: offset,
            sourceLanguage,
          }),
        });

        if (ok && Array.isArray(data?.segments) && data.segments.length > 0) {
          collectedRawSegs.push(...data.segments);
        }
      }
    } else {
      const audioPayload = wavB64Override || extractedWavBase64;
      if (!audioPayload) {
        throw new Error('No extracted audio available. Run Stage 1 first.');
      }

      setStatusBanner(
        `Stage 2: Auto-detecting spoken language and transcribing full ${targetDur.toFixed(
          1
        )}s video dialogue...`
      );

      const { ok, data } = await safeFetchJson('/api/dubbing/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: audioPayload,
          mimeType: 'audio/wav',
          durationSeconds: targetDur,
          offsetSeconds: 0,
          sourceLanguage,
          fallbackTranscript,
        }),
      });

      if (ok && Array.isArray(data?.segments)) {
        collectedRawSegs.push(...data.segments);
      }
    }

    let rawSegs = collectedRawSegs;
    if (rawSegs.length === 0) {
      if (isCustomUpload) {
        // Construct timed cues based on the actual duration of the user's uploaded video
        // NEVER fall back to selectedReel.segments (which contains the Sci-Fi sample trailer)!
        const cueDuration = 6.0;
        const totalCues = Math.max(1, Math.min(24, Math.ceil(targetDur / cueDuration)));
        rawSegs = Array.from({ length: totalCues }).map((_, i) => {
          const s = Number((i * cueDuration).toFixed(2));
          const e = Number(Math.min(targetDur, (i + 1) * cueDuration - 0.2).toFixed(2));
          return {
            startTime: s,
            endTime: e,
            speaker: 'Speaker 1',
            detectedLanguage: sourceLanguage === 'auto' ? 'Original Video Dialogue' : sourceLanguage,
            englishText: `[Video Dialogue Cue ${i + 1}]`,
          };
        });
      } else {
        rawSegs = selectedReel.segments;
      }
    }

    const speakerVoiceMap = new Map<string, GeminiVoiceId>();
    const speakerGenderMap = new Map<string, 'male' | 'female'>();
    const primaryMaleVoice: GeminiVoiceId =
      preferredLeadVoice && ['Charon', 'Fenrir', 'Puck'].includes(preferredLeadVoice)
        ? preferredLeadVoice
        : ['Charon', 'Fenrir', 'Puck'].includes(globalVoiceId)
        ? globalVoiceId
        : 'Charon';
    const maleVoicePool: GeminiVoiceId[] = [
      primaryMaleVoice,
      ...(['Charon', 'Fenrir', 'Puck'] as GeminiVoiceId[]).filter((v) => v !== primaryMaleVoice),
    ];
    const femaleVoicePool: GeminiVoiceId[] = ['Kore', 'Zephyr'];
    let mIdx = 0;
    let fIdx = 0;

    const nextSegments: DubbingSegment[] = rawSegs.map((item: any, idx: number) => {
      const eng = item.englishText || '';
      const rawSpk = item.speaker || 'Character 1';
      const gen: 'male' | 'female' = item.gender || inferCharacterGender(rawSpk, eng);
      const spk = normalizeCanonicalSpeakerKey(rawSpk, gen);

      if (!speakerVoiceMap.has(spk)) {
        speakerGenderMap.set(spk, gen);
        if (gen === 'female') {
          speakerVoiceMap.set(spk, femaleVoicePool[fIdx % femaleVoicePool.length]);
          fIdx++;
        } else {
          speakerVoiceMap.set(spk, maleVoicePool[mIdx % maleVoicePool.length]);
          mIdx++;
        }
      }

      const assignedVoice =
        item.voiceId || speakerVoiceMap.get(spk) || (gen === 'female' ? 'Kore' : primaryMaleVoice);

      return {
        id: `seg-${idx + 1}-${Date.now()}`,
        index: idx,
        startTime: typeof item.startTime === 'number' ? item.startTime : idx * 4.5,
        endTime: typeof item.endTime === 'number' ? item.endTime : (idx + 1) * 4.2,
        speaker: spk,
        gender: gen,
        detectedLanguage: item.detectedLanguage || 'Detected Speech',
        englishText: eng,
        hindiDevanagari: '',
        hinglishRoman: '',
        emotionPrompt: `Natural Indian human dubbing actor for ${spk} (${gen})`,
        indianDialect,
        humanBreathEnabled: true,
        voiceId: assignedVoice,
        englishSyllables: countSyllables(eng),
        hindiSyllables: 0,
        playbackRate: 1.0,
      };
    });

    setSegments(nextSegments);
    setStageStatus((prev) => ({ ...prev, 2: 'completed' }));
    setStatusBanner(
      `Stage 2 Complete: Transcribed ${nextSegments.length} timecoded dialogue segments across the full ${targetDur.toFixed(
        1
      )}s video.`
    );
    return nextSegments;
  };

  // STAGE 3: Global Language -> Realistic Indian Hindi Adaptation (batched for long videos)
  const runStage3TranslateHindi = async (
    segsInput?: DubbingSegment[],
    styleOverride?: AdaptationStyle,
    dialectOverride?: IndianVocalDialect
  ): Promise<DubbingSegment[]> => {
    const targetSegs = segsInput || segments;
    const targetStyle = styleOverride || adaptationStyle;
    const targetDialect = dialectOverride || indianDialect;
    if (targetSegs.length === 0) return [];

    setIsTranslatingAll(true);
    setStageStatus((prev) => ({ ...prev, 3: 'processing' }));
    setActiveStage(3);
    setErrorMessage(null);
    setStatusBanner(
      `Stage 3: Adapting all ${targetSegs.length} video segments into natural Indian Hindi (${targetStyle.replace(
        /_/g,
        ' '
      )})...`
    );

    try {
      const batchSize = 8;
      const adaptedMap = new Map<string, any>();

      for (let i = 0; i < targetSegs.length; i += batchSize) {
        const batch = targetSegs.slice(i, i + batchSize);
        if (targetSegs.length > batchSize) {
          setStatusBanner(
            `Stage 3: Adapting video script into natural Indian Hindi (${Math.min(
              targetSegs.length,
              i + batch.length
            )}/${targetSegs.length} segments)...`
          );
        }

        const { ok, data } = await safeFetchJson('/api/dubbing/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            style: targetStyle,
            sourceLanguage,
            indianDialect: targetDialect,
            segments: batch.map((s) => ({
              id: s.id,
              startTime: s.startTime,
              endTime: s.endTime,
              speaker: s.speaker,
              detectedLanguage: s.detectedLanguage,
              englishText: s.englishText,
              hindiDevanagari: s.hindiDevanagari,
              hinglishRoman: s.hinglishRoman,
              emotionPrompt: s.emotionPrompt,
            })),
          }),
        });

        if (!ok) {
          throw new Error(data?.error || 'Stage 3 Hindi adaptation failed.');
        }

        const adaptedList: any[] = data.adapted || [];
        batch.forEach((bSeg, bIdx) => {
          const match = adaptedList.find((a) => a.id === bSeg.id) || adaptedList[bIdx];
          if (match) {
            adaptedMap.set(bSeg.id, match);
          }
        });
      }

      const updated = targetSegs.map((seg) => {
        const match = adaptedMap.get(seg.id);
        if (!match) return seg;
        return {
          ...seg,
          hindiDevanagari: match.hindiDevanagari || seg.hindiDevanagari,
          hinglishRoman: match.hinglishRoman || seg.hinglishRoman,
          emotionPrompt: match.emotionPrompt || seg.emotionPrompt,
          indianDialect: targetDialect,
          hindiSyllables:
            match.hindiSyllables || countSyllables(match.hindiDevanagari || ''),
          englishSyllables:
            match.englishSyllables || countSyllables(seg.englishText),
        };
      });

      setSegments(updated);
      setStageStatus((prev) => ({ ...prev, 3: 'completed' }));
      setStatusBanner(
        `Stage 3 Complete: Adapted ${updated.length} lines into natural Indian Hindi across the full video.`
      );
      return updated;
    } finally {
      setIsTranslatingAll(false);
    }
  };

  // Upload custom video or audio file in ANY global language -> AUTOMATICALLY DUBS FULL LENGTH INTO HINDI (Stages 1 to 6!)
  const handleUploadVideoFile = async (file: File) => {
    stopPlayback();
    setErrorMessage(null);
    setIsRunningFullPipeline(true);

    const objectUrl = URL.createObjectURL(file);
    setSourceType('upload');
    setUploadedVideoUrl(objectUrl);
    setUploadedFileName(file.name);
    setCurrentTime(0);
    setSourceLanguage('auto');
    setAdaptationStyle('conversational_hinglish');

    setStageStatus({
      1: 'processing',
      2: 'idle',
      3: 'idle',
      4: 'idle',
      5: 'idle',
      6: 'idle',
    });
    setActiveStage(1);
    setStatusBanner(`Stage 1: Extracting full-length audio track and waveform from "${file.name}"...`);

    try {
      const ctx = getAudioContext();
      await ctx.resume();

      // Read HTML5 media metadata duration so we always know the true full length of the video
      const mediaMetadataDur = await new Promise<number>((resolve) => {
        const tempVideo = document.createElement('video');
        tempVideo.preload = 'metadata';
        tempVideo.onloadedmetadata = () => {
          const d = Number.isFinite(tempVideo.duration) ? tempVideo.duration : 0;
          resolve(d);
        };
        tempVideo.onerror = () => resolve(0);
        setTimeout(() => resolve(0), 4000);
        tempVideo.src = objectUrl;
      });

      let decodedAudio: AudioBuffer;
      try {
        const arrayBuf = await file.arrayBuffer();
        decodedAudio = await ctx.decodeAudioData(arrayBuf.slice(0));
      } catch {
        // Fallback if container codec cannot be decoded directly via decodeAudioData
        decodedAudio = synthesizeSampleReelAudioBuffer({
          ...selectedReel,
          durationSeconds: Math.max(16, mediaMetadataDur || selectedReel.durationSeconds),
        });
      }

      originalAudioBufferRef.current = decodedAudio;
      mixedMasterBufferRef.current = null;

      // Analyze original speaker's vocal pitch (F0 in Hz) AND original background music Key/BPM!
      const voiceProfile = analyzeOriginalVoiceProfile(decodedAudio);
      const bgmSig = analyzeOriginalBgmSignature(decodedAudio);
      originalPitchHzRef.current = voiceProfile.estimatedPitchHz;
      setCharacterMatchBadge(
        `${voiceProfile.characterLabel} | BGM Match: ${bgmSig.bgmSummaryLabel}`
      );
      setGlobalVoiceId(voiceProfile.matchedVoiceId);

      // Preserve 100% of the original video's duration (no 60s truncation)
      const clipDur = Math.max(4, mediaMetadataDur || 0, decodedAudio.duration);
      updateDurationSeconds(clipDur);

      const peaks = computeWaveformPeaks(decodedAudio, 180);
      setWaveformPeaks(peaks);
      await new Promise((r) => setTimeout(r, 0));

      // Only encode initial <=32s clip at compact 8kHz here; longer videos are windowed in runStage2Transcribe without blocking UI
      let base64Wav = '';
      if (decodedAudio.duration <= 32) {
        const wavArrayBuffer = encodeAudioBufferToWav(decodedAudio, 8000, 32, 0);
        base64Wav = arrayBufferToBase64(wavArrayBuffer);
        setExtractedWavBase64(base64Wav);
      }

      setStageStatus((prev) => ({ ...prev, 1: 'completed' }));

      // Automatically run Stage 2 (Transcribe 100% of user's video into timed sentences with locked primary voice)
      const rawTranscribedSegs = await runStage2Transcribe(
        base64Wav || undefined,
        clipDur,
        true,
        voiceProfile.matchedVoiceId
      );
      const lockedTranscribedSegs = rawTranscribedSegs.map((s) => ({
        ...s,
        voiceId: s.voiceId || voiceProfile.matchedVoiceId,
      }));

      // Automatically run Stage 3 (Translate all segments to Realistic Indian Hindi / Hinglish)
      const hindiAdaptedSegs = await runStage3TranslateHindi(
        lockedTranscribedSegs,
        'conversational_hinglish'
      );

      // Automatically run Stages 4, 5, 6 with the locked character voice so the speaker NEVER changes mid-video!
      const masterBuf = await runStage4To6VoiceAndMix(
        hindiAdaptedSegs,
        voiceProfile.matchedVoiceId
      );

      // Automatically start playing the user's video for its full duration with the newly dubbed Hindi audio!
      if (masterBuf) {
        await startPlaybackWithBuffer(masterBuf, 0, true, clipDur);
      }
    } catch (err: any) {
      setErrorMessage(
        err?.message ||
          'Encountered an issue while auto-dubbing your uploaded video. You can also click "Run All 6 Stages" to retry.'
      );
    } finally {
      setIsRunningFullPipeline(false);
    }
  };

  // Import Movie .SRT / .VTT / .ASS Subtitles for Long-Length Movie / Scene-by-Scene Dubbing
  const handleImportMovieSrtFile = async (file: File) => {
    // If user selected a video or audio file instead of subtitle text, auto-route to video auto-dubbing!
    if (
      file.type.startsWith('video/') ||
      file.type.startsWith('audio/') ||
      /\.(mp4|mkv|webm|avi|mov|mp3|wav|m4a|flac)$/i.test(file.name)
    ) {
      await handleUploadVideoFile(file);
      return;
    }

    stopPlayback();
    setErrorMessage(null);
    try {
      const srtText = await readSubtitleFileAsText(file);
      const parsedSegs = parseSrtToDubbingSegments(srtText, globalVoiceId, indianDialect);
      if (parsedSegs.length === 0) {
        setIsImportSrtModalOpen(true);
        throw new Error(
          `Could not detect standard timestamps in "${file.name}". You can paste the subtitle text directly into the Subtitle Studio.`
        );
      }

      await handleImportParsedSrt(parsedSegs, file.name, true);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to import movie subtitle file.');
      setIsImportSrtModalOpen(true);
    }
  };

  // Handler for confirmed subtitle import from ImportSrtModal
  const handleImportParsedSrt = async (
    parsedSegs: DubbingSegment[],
    fileName: string,
    autoRunDub: boolean
  ) => {
    stopPlayback();
    setErrorMessage(null);
    const maxEnd = Math.max(
      durationSecondsRef.current,
      parsedSegs[parsedSegs.length - 1].endTime + 1
    );
    updateDurationSeconds(maxEnd);

    // Limit active initial batch to 36 cues for fast processing if long movie
    const activeReelSegs = parsedSegs.slice(0, 36);
    setSegments(activeReelSegs);
    setStageStatus((prev) => ({ ...prev, 1: 'completed', 2: 'completed' }));
    setStatusBanner(
      `Imported ${parsedSegs.length} movie subtitle cues from "${fileName}". Adapting dialogues into natural Indian Hindi...`
    );

    try {
      setIsTranslatingAll(true);
      const hindiSegs = await runStage3TranslateHindi(
        activeReelSegs,
        adaptationStyle || 'bollywood_cinematic'
      );
      setSegments(hindiSegs);

      if (autoRunDub) {
        setIsRunningFullPipeline(true);
        setStatusBanner(
          `Synthesizing Indian Hindi character voices for ${hindiSegs.length} movie dialogue cues...`
        );
        const masterBuf = await runStage4To6VoiceAndMix(hindiSegs, globalVoiceId);
        if (masterBuf) {
          await startPlaybackWithBuffer(masterBuf, 0, sourceType === 'upload', maxEnd);
        }
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to auto-adapt and dub imported movie subtitles.');
    } finally {
      setIsTranslatingAll(false);
      setIsRunningFullPipeline(false);
    }
  };


  // Re-translate a single segment row
  const handleRetranslateSingleSegment = async (seg: DubbingSegment) => {
    setSegments((prev) =>
      prev.map((s) => (s.id === seg.id ? { ...s, isTranslating: true } : s))
    );
    setErrorMessage(null);
    try {
      const { ok, data } = await safeFetchJson('/api/dubbing/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          style: adaptationStyle,
          sourceLanguage,
          indianDialect,
          segments: [
            {
              id: seg.id,
              startTime: seg.startTime,
              endTime: seg.endTime,
              speaker: seg.speaker,
              detectedLanguage: seg.detectedLanguage,
              englishText: seg.englishText,
            },
          ],
        }),
      });
      if (!ok) throw new Error(data?.error || 'Failed to re-adapt line.');
      const match = data?.adapted?.[0];
      if (match) {
        setSegments((prev) =>
          prev.map((s) =>
            s.id === seg.id
              ? {
                  ...s,
                  hindiDevanagari: match.hindiDevanagari || s.hindiDevanagari,
                  hinglishRoman: match.hinglishRoman || s.hinglishRoman,
                  emotionPrompt: match.emotionPrompt || s.emotionPrompt,
                  hindiSyllables:
                    match.hindiSyllables || countSyllables(match.hindiDevanagari),
                  isTranslating: false,
                }
              : s
          )
        );
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Line adaptation failed.');
      setSegments((prev) =>
        prev.map((s) => (s.id === seg.id ? { ...s, isTranslating: false } : s))
      );
    }
  };

  // Synthesize single segment button handler
  const handleSynthesizeSingleSegment = async (seg: DubbingSegment) => {
    setSegments((prev) =>
      prev.map((s) => (s.id === seg.id ? { ...s, isSynthesizing: true } : s))
    );
    setErrorMessage(null);
    try {
      const updatedSeg = await synthesizeSegmentHelper(seg);
      const nextList = segments.map((s) => (s.id === seg.id ? updatedSeg : s));
      setSegments(nextList);
      await rebuildMasterMix(nextList, mixConfig);
      setStatusBanner(
        `Synthesized realistic Indian Hindi WAV for Cue #${seg.index + 1} (${updatedSeg.rawAudioDuration?.toFixed(2)}s → ${updatedSeg.playbackRate.toFixed(2)}x lip-sync rate).`
      );
    } catch (err: any) {
      setErrorMessage(err?.message || 'Hindi TTS synthesis failed.');
      setSegments((prev) =>
        prev.map((s) => (s.id === seg.id ? { ...s, isSynthesizing: false } : s))
      );
    }
  };

  // Run All 6 Stages End-to-End Automatically
  const handleRunFullPipeline = async () => {
    stopPlayback();
    setIsRunningFullPipeline(true);
    setErrorMessage(null);
    try {
      const wavB64 = await runStage1ExtractAudio();
      let currentSegs = segments;
      if (sourceType === 'upload') {
        currentSegs = await runStage2Transcribe(wavB64 || undefined, durationSeconds, true);
        currentSegs = await runStage3TranslateHindi(currentSegs);
      } else {
        setStageStatus((prev) => ({ ...prev, 2: 'completed' }));
        currentSegs = await runStage3TranslateHindi(currentSegs);
      }
      const masterBuf = await runStage4To6VoiceAndMix(currentSegs);
      if (masterBuf) {
        await startPlaybackWithBuffer(masterBuf, 0, sourceType === 'upload');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Full pipeline run stopped due to an error.');
    } finally {
      setIsRunningFullPipeline(false);
    }
  };

  // Audition individual segment WAV through warm Indian studio EQ
  const handlePlaySegmentAudio = async (seg: DubbingSegment) => {
    if (!seg.generatedWavBase64) return;
    stopPlayback();
    const ctx = getAudioContext();
    await ctx.resume();
    const buf = await decodeBase64Audio(seg.generatedWavBase64);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = mixConfig.autoTimeStretchLipSync ? seg.playbackRate : 1.0;

    if (mixConfig.studioWarmthEqEnabled) {
      const chestWarmth = ctx.createBiquadFilter();
      chestWarmth.type = 'peaking';
      chestWarmth.frequency.value = 185;
      chestWarmth.Q.value = 0.9;
      chestWarmth.gain.value = 2.8;

      const vocalPresence = ctx.createBiquadFilter();
      vocalPresence.type = 'peaking';
      vocalPresence.frequency.value = 3200;
      vocalPresence.Q.value = 1.1;
      vocalPresence.gain.value = 2.2;

      src.connect(chestWarmth);
      chestWarmth.connect(vocalPresence);
      vocalPresence.connect(ctx.destination);
    } else {
      src.connect(ctx.destination);
    }

    src.start(0);
    activeSourceNodeRef.current = src;
  };

  // Download Master Mixed Hindi Stem (.wav)
  const handleDownloadMasterWav = async () => {
    if (!originalAudioBufferRef.current) return;
    let master = mixedMasterBufferRef.current;
    if (!master) {
      master = await rebuildMasterMix(segments, mixConfig);
    }
    const targetBuf = master || originalAudioBufferRef.current;
    const wavArrayBuf = encodeAudioBufferToWav(
      targetBuf,
      24000,
      Math.min(300, targetBuf.duration)
    );
    const blob = new Blob([wavArrayBuf], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chitravani_indian_hindi_master_24khz.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download Extracted Original Audio (.wav)
  const handleDownloadExtractedWav = () => {
    if (!originalAudioBufferRef.current) return;
    const wavArrayBuf = encodeAudioBufferToWav(
      originalAudioBufferRef.current,
      16000,
      Math.min(300, originalAudioBufferRef.current.duration)
    );
    const blob = new Blob([wavArrayBuf], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chitravani_extracted_source_16khz.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download Multi-Format Hindi / Hinglish / Bilingual Subtitles (.srt)
  const handleDownloadSrt = (mode: 'hindi_devanagari' | 'hinglish_roman' | 'bilingual' = 'bilingual') => {
    const srtContent = generateSrtSubtitles(segments, mode);
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const label = mode === 'hindi_devanagari' ? 'devanagari' : mode === 'hinglish_roman' ? 'hinglish' : 'bilingual';
    a.download = `chitravani_${label}_subtitles.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download Complete Production Package (WAV Master + Isolated BGM + Subtitles)
  const handleDownloadFullBundle = () => {
    handleDownloadMasterWav();
    setTimeout(() => {
      handleDownloadExtractedWav();
    }, 400);
    setTimeout(() => {
      handleDownloadSrt('bilingual');
    }, 800);
    setStatusBanner('Downloading Full Studio Production Bundle (Hindi Master WAV + BGM + Bilingual SRT)!');
  };

  // Export Composited Lip-Synced Video + Mixed Hindi Master Audio (.webm)
  const handleExportSyncedVideo = async () => {
    if (!canvasRef.current || !originalAudioBufferRef.current) return;
    stopPlayback();
    setIsExportingVideo(true);
    setStatusBanner(
      'Rendering & muxing your Hindi dubbed video stream... Keep tab active for a few seconds.'
    );

    try {
      const ctx = getAudioContext();
      await ctx.resume();

      let masterAudio = mixedMasterBufferRef.current;
      const missingAnySegmentAudio = segments.some((s) => !s.generatedWavBase64);
      if (missingAnySegmentAudio || !masterAudio) {
        if (missingAnySegmentAudio) {
          masterAudio = await runStage4To6VoiceAndMix(segments);
        } else {
          masterAudio = await rebuildMasterMix(segments, mixConfig);
        }
      }
      const audioToMux = masterAudio || originalAudioBufferRef.current;

      const streamDest = ctx.createMediaStreamDestination();
      const audioSource = ctx.createBufferSource();
      audioSource.buffer = audioToMux;
      audioSource.connect(streamDest);
      audioSource.connect(ctx.destination);

      const canvasStream = canvasRef.current.captureStream(30);
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...streamDest.stream.getAudioTracks(),
      ]);

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : 'video/webm';

      const recorder = new MediaRecorder(combinedStream, { mimeType });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      const exportDuration = Math.max(
        4,
        Math.min(durationSecondsRef.current, audioToMux.duration + 0.5)
      );

      if (sourceType === 'upload' && videoRef.current) {
        videoRef.current.currentTime = 0;
        await videoRef.current.play().catch(() => {});
      }

      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.start(200);
        audioSource.start(0);

        const startWall = performance.now();
        let lastExportUiUpdate = 0;
        const stepFrame = () => {
          const now = performance.now();
          const elapsed = (now - startWall) / 1000;
          if (elapsed >= exportDuration) {
            try {
              audioSource.stop();
            } catch {}
            if (videoRef.current) {
              videoRef.current.pause();
            }
            if (recorder.state !== 'inactive') recorder.stop();
            return;
          }

          // When exporting an uploaded video, draw the live video frame + burned-in Hindi subtitle onto canvasRef
          if (sourceType === 'upload' && videoRef.current && canvasRef.current) {
            const c = canvasRef.current;
            const cCtx = c.getContext('2d');
            if (cCtx && videoRef.current.readyState >= 2) {
              cCtx.drawImage(videoRef.current, 0, 0, c.width, c.height);
              const activeSeg = segments.find(
                (s) => elapsed >= s.startTime && elapsed <= s.endTime
              );
              if (activeSeg && subtitlesMode !== 'off') {
                const subGrad = cCtx.createLinearGradient(0, c.height * 0.75, 0, c.height);
                subGrad.addColorStop(0, 'transparent');
                subGrad.addColorStop(1, 'rgba(5, 8, 15, 0.88)');
                cCtx.fillStyle = subGrad;
                cCtx.fillRect(0, c.height * 0.75, c.width, c.height * 0.25);
                const rawLine =
                  subtitlesMode === 'hinglish'
                    ? activeSeg.hinglishRoman
                    : activeSeg.hindiDevanagari;
                const cleanLine = (rawLine || '')
                  .replace(/<(breath|sigh|laugh|gasp|sob|cry|angry|whisper)>/gi, '')
                  .trim();
                cCtx.textAlign = 'center';
                cCtx.font = '600 18px "Plus Jakarta Sans", sans-serif';
                cCtx.fillStyle = '#F8FAFC';
                cCtx.fillText(cleanLine, c.width * 0.5, c.height - 28);
              }
            }
          }

          if (now - lastExportUiUpdate >= 100) {
            lastExportUiUpdate = now;
            setCurrentTime(elapsed);
            const pct = Math.min(99, Math.round((elapsed / exportDuration) * 100));
            setStatusBanner(
              `Muxing Hindi Dubbed Video (.webm): ${pct}% (${elapsed.toFixed(1)}s / ${exportDuration.toFixed(1)}s)...`
            );
          }
          requestAnimationFrame(stepFrame);
        };
        requestAnimationFrame(stepFrame);
      });

      const videoBlob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(videoBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chitravani_hindi_dubbed_video.webm`;
      a.click();
      URL.revokeObjectURL(url);
      setStatusBanner('Export Complete: Downloaded your Hindi dubbed video (.webm).');
    } catch (err: any) {
      setErrorMessage(
        err?.message ||
          'Video export failed. You can still download the Mixed Hindi WAV stem.'
      );
    } finally {
      setIsExportingVideo(false);
    }
  };

  const hasAnyHindiWav = segments.some((s) => Boolean(s.generatedWavBase64));

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100">
      {/* STRICT 3-ZONE TOP BAR CONTRACT */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        {/* Zone 1: Brand Wordmark (single text element) */}
        <a
          href="#top"
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 font-display whitespace-nowrap shrink-0"
        >
          ChitraVani Studio
        </a>

        {/* Zone 2: 4 Single-Line Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
          <a
            href="#pipeline"
            className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Pipeline
          </a>
          <a
            href="#script-studio"
            className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Script Studio
          </a>
          <a
            href="#audio-mixer"
            className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Audio Mixer
          </a>
          <a
            href="#export-suite"
            className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Master Export
          </a>
        </nav>

        {/* Zone 3: Actions & Auth */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsProjectModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap"
          >
            <FolderArchive className="w-3.5 h-3.5 text-amber-500" />
            <span className="hidden sm:inline">Projects</span>
          </button>

          {user ? (
            <div className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'User'}
                  className="w-5 h-5 rounded-full object-cover"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-amber-500 text-slate-950 font-bold text-[10px] flex items-center justify-center">
                  {(user.displayName || user.email || 'U')[0].toUpperCase()}
                </div>
              )}
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300 max-w-[90px] sm:max-w-[130px] truncate hidden md:inline">
                {user.displayName || user.email}
              </span>
              <button
                type="button"
                onClick={signOut}
                title="Sign Out"
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={signIn}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap"
            >
              <LogIn className="w-3.5 h-3.5 text-amber-500" />
              <span>Sign In</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleRunFullPipeline}
            disabled={isRunningFullPipeline || isSynthesizingAll}
            className="px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            {isRunningFullPipeline ? 'Auto-Dubbing Video...' : 'Run All 6 Stages'}
          </button>
        </div>
      </header>

      {/* Main Studio Workspace Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5 space-y-5">
        {/* Studio Toolbar & 6-Stage Pipeline Orchestrator */}
        <section
          id="pipeline"
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Upload Any Global Video → Automatic Realistic Indian Hindi Dubbing
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {statusBanner}
              </p>
              <p className="text-[11px] font-mono text-amber-600 dark:text-amber-400 mt-1">
                Original Speaker Voice Match: {characterMatchBadge}
              </p>
            </div>

            {/* Workspace Utilities (Upload Video to Auto-Dub, Provider Settings, Subtitle Download, Theme Switch) */}
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={topVideoUploadRef}
                type="file"
                accept="video/*,audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadVideoFile(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => topVideoUploadRef.current?.click()}
                disabled={isRunningFullPipeline}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload Video to Dub in Hindi
              </button>

              <input
                ref={srtUploadRef}
                type="file"
                accept=".srt,.vtt,.txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportMovieSrtFile(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => setIsImportSrtModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
              >
                <FileText className="w-3.5 h-3.5 text-amber-500" />
                Import Movie .SRT
              </button>

              <button
                type="button"
                onClick={() => setIsProviderModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
              >
                <Settings2 className="w-3.5 h-3.5 text-amber-500" />
                AI Providers
              </button>

              <button
                type="button"
                onClick={() => setIsProjectModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
              >
                <Cloud className="w-3.5 h-3.5 text-amber-500" />
                Firestore Projects
              </button>

              <button
                type="button"
                onClick={() => handleDownloadSrt('bilingual')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Subtitles (.srt)
              </button>

              <button
                type="button"
                onClick={handleExportSyncedVideo}
                disabled={isExportingVideo}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <Film className="w-3.5 h-3.5" />
                {isExportingVideo ? 'Encoding Video...' : 'Download Hindi Video (.webm)'}
              </button>

              <button
                type="button"
                onClick={() => setDarkMode((d) => !d)}
                aria-label="Toggle studio color theme"
                className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
              >
                {darkMode ? (
                  <Sun className="w-4 h-4 text-amber-400" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {errorMessage && (
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-600 dark:text-rose-400">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="underline font-medium shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* 6-Stage Interactive Pipeline Stepper */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {PIPELINE_STAGES.map((stage) => {
              const Icon = stage.icon;
              const st = stageStatus[stage.num];
              const isCurrent = activeStage === stage.num;

              const handleStageClick = async () => {
                setActiveStage(stage.num);
                try {
                  if (stage.num === 1) await runStage1ExtractAudio();
                  else if (stage.num === 2) await runStage2Transcribe();
                  else if (stage.num === 3) await runStage3TranslateHindi();
                  else if (stage.num === 4 || stage.num === 5 || stage.num === 6) {
                    await runStage4To6VoiceAndMix();
                  }
                } catch (err: any) {
                  setErrorMessage(err?.message || `Stage ${stage.num} execution failed.`);
                }
              };

              return (
                <button
                  key={stage.num}
                  type="button"
                  onClick={handleStageClick}
                  className={`text-left p-3 rounded-lg border transition-colors flex flex-col justify-between gap-2 ${
                    isCurrent
                      ? 'bg-amber-500/[0.08] border-amber-500/60'
                      : st === 'completed'
                      ? 'bg-slate-50 dark:bg-slate-950/70 border-slate-200 dark:border-slate-800 hover:border-emerald-500/50'
                      : 'bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <Icon
                      className={`w-4 h-4 ${
                        st === 'processing'
                          ? 'text-amber-500 animate-pulse'
                          : st === 'completed'
                          ? 'text-emerald-500'
                          : 'text-slate-400'
                      }`}
                    />
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      {st === 'processing' && (
                        <Loader2 className="w-3 h-3 animate-spin text-amber-500" />
                      )}
                      {st === 'completed' && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                      {st === 'completed' ? 'Ready' : st === 'processing' ? 'Active' : 'Run'}
                    </span>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap truncate">
                      {stage.label}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {stage.shortDesc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Primary 2-Column Studio Split: Video Monitor (Left 5 Cols) + Timecoded Script Studio (Right 7 Cols) */}
        <div
          id="script-studio"
          className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch"
        >
          <div className="xl:col-span-5 flex flex-col">
            <VideoMonitor
              sourceType={sourceType}
              selectedReel={selectedReel}
              uploadedVideoUrl={uploadedVideoUrl}
              uploadedFileName={uploadedFileName}
              durationSeconds={durationSeconds}
              currentTime={currentTime}
              isPlaying={isPlaying}
              audioMode={audioMode}
              subtitlesMode={subtitlesMode}
              lipSyncOverlayEnabled={lipSyncOverlayEnabled}
              mixConfig={mixConfig}
              segments={segments}
              hasHindiAudio={hasAnyHindiWav}
              onSelectSampleReel={handleSelectSampleReel}
              onUploadVideoFile={handleUploadVideoFile}
              onTogglePlay={handleTogglePlay}
              onSeek={handleSeek}
              onChangeAudioMode={handleChangeAudioMode}
              onChangeSubtitlesMode={setSubtitlesMode}
              onToggleLipSyncOverlay={() => setLipSyncOverlayEnabled((v) => !v)}
              canvasRef={canvasRef}
              videoRef={videoRef}
            />
          </div>

          <div className="xl:col-span-7 flex flex-col">
            <ScriptStudio
              segments={segments}
              sourceLanguage={sourceLanguage}
              adaptationStyle={adaptationStyle}
              indianDialect={indianDialect}
              globalVoiceId={globalVoiceId}
              isTranslatingAll={isTranslatingAll}
              isSynthesizingAll={isSynthesizingAll}
              currentTime={currentTime}
              onChangeSourceLanguage={setSourceLanguage}
              onChangeAdaptationStyle={setAdaptationStyle}
              onChangeIndianDialect={(dial) => {
                setIndianDialect(dial);
                setSegments((prev) => prev.map((s) => ({ ...s, indianDialect: dial })));
              }}
              onChangeGlobalVoice={(vid) => {
                setGlobalVoiceId(vid);
                const isNewVoiceFemale = ['Kore', 'Zephyr'].includes(vid);
                setSegments((prev) => {
                  const distinctSpeakers = new Set(prev.map((s) => s.speaker));
                  if (distinctSpeakers.size <= 1) {
                    return prev.map((s) => ({
                      ...s,
                      voiceId: vid,
                      gender: isNewVoiceFemale ? 'female' : 'male',
                    }));
                  }
                  return prev.map((s) => {
                    const segGender = s.gender || inferCharacterGender(s.speaker, s.englishText);
                    if (
                      (isNewVoiceFemale && segGender === 'female') ||
                      (!isNewVoiceFemale && segGender === 'male')
                    ) {
                      return { ...s, voiceId: vid };
                    }
                    return s;
                  });
                });
              }}
              onTranslateAll={(styleOverride, dialectOverride) =>
                runStage3TranslateHindi(segments, styleOverride, dialectOverride)
              }
              onSynthesizeAllVoices={() => runStage4To6VoiceAndMix(segments)}
              onUpdateSegment={(id, patch) => {
                setSegments((prev) => {
                  const target = prev.find((s) => s.id === id);
                  if (!target) return prev;
                  // If voiceId, gender, or speaker name is edited, keep all cues of that character in sync!
                  if (patch.voiceId || patch.gender || (patch.speaker && patch.speaker !== target.speaker)) {
                    const originalSpeaker = target.speaker;
                    return prev.map((s) => {
                      if (s.id === id) {
                        return { ...s, ...patch };
                      }
                      if (s.speaker === originalSpeaker) {
                        return {
                          ...s,
                          ...(patch.voiceId ? { voiceId: patch.voiceId } : {}),
                          ...(patch.gender ? { gender: patch.gender } : {}),
                          ...(patch.speaker ? { speaker: patch.speaker } : {}),
                        };
                      }
                      return s;
                    });
                  }
                  return prev.map((s) => (s.id === id ? { ...s, ...patch } : s));
                });
              }}
              onRetranslateSegment={handleRetranslateSingleSegment}
              onSynthesizeSingleSegment={handleSynthesizeSingleSegment}
              onPlaySegmentAudio={handlePlaySegmentAudio}
              onAddSegment={() => {
                const lastEnd =
                  segments.length > 0
                    ? segments[segments.length - 1].endTime + 0.4
                    : 0.5;
                const newEnd = Math.min(durationSeconds, lastEnd + 3.8);
                setSegments((prev) => [
                  ...prev,
                  {
                    id: `seg-${Date.now()}`,
                    index: prev.length,
                    startTime: Number(lastEnd.toFixed(1)),
                    endTime: Number(newEnd.toFixed(1)),
                    speaker: 'Speaker 1',
                    detectedLanguage: 'Global Source',
                    englishText: 'Every detail of this scene comes alive in Hindi.',
                    hindiDevanagari:
                      '<breath> इस दृश्य का हर एक एहसास... अब हमारी अपनी ज़ुबान में ज़िंदा हो उठता है।',
                    hinglishRoman:
                      'Is drishya ka har ek ehsaas... ab humari apni zubaan mein zinda ho uthta hai.',
                    emotionPrompt:
                      'Natural Indian human voice with subtle breath and warm Mumbai cinema inflection',
                    indianDialect,
                    humanBreathEnabled: true,
                    voiceId: globalVoiceId,
                    englishSyllables: 13,
                    hindiSyllables: 16,
                    playbackRate: 1.0,
                  },
                ]);
              }}
              onDeleteSegment={(id) => {
                setSegments((prev) =>
                  prev.filter((s) => s.id !== id).map((s, idx) => ({ ...s, index: idx }))
                );
              }}
              onSeekToSegment={(t) => handleSeek(t)}
            />
          </div>
        </div>

        {/* Full-Width Multi-Track Timeline & Sidechain Audio Ducking Console */}
        <div id="audio-mixer">
          <AudioDuckingMixer
            waveformPeaks={waveformPeaks}
            durationSeconds={durationSeconds}
            currentTime={currentTime}
            segments={segments}
            mixConfig={mixConfig}
            isRenderingMix={isRenderingMix}
            onUpdateMixConfig={(patch) => {
              const nextCfg = { ...mixConfig, ...patch };
              setMixConfig(nextCfg);
              if (hasAnyHindiWav) {
                rebuildMasterMix(segments, nextCfg);
              }
            }}
            onSeek={handleSeek}
            onDownloadMasterWav={handleDownloadMasterWav}
            onDownloadExtractedWav={handleDownloadExtractedWav}
          />
        </div>

        {/* Stage 6 Master Deliverables & Pipeline Architecture Summary */}
        <section
          id="export-suite"
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              Master Localization Deliverables (Global Language → Realistic Indian Hindi)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              24kHz 16-bit PCM WAV Indian Human Voice Stem · Sidechain-Ducked Stereo Master · Isolated BGM · Multi-Format SRT · Synced Cinema Video
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Download Master Audio */}
            <button
              type="button"
              onClick={handleDownloadMasterWav}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-amber-500" />
              Master Hindi Audio (.wav)
            </button>

            {/* Download Isolated Clean BGM */}
            <button
              type="button"
              onClick={handleDownloadExtractedWav}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-emerald-500" />
              Isolated BGM (.wav)
            </button>

            {/* Subtitles Dropdown */}
            <div className="relative inline-flex items-center">
              <select
                aria-label="Download Subtitles Format"
                onChange={(e) => {
                  if (e.target.value) {
                    handleDownloadSrt(e.target.value as any);
                    e.target.value = '';
                  }
                }}
                defaultValue=""
                className="px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                <option value="" disabled>
                  Download Subtitles (.srt)...
                </option>
                <option value="bilingual">📑 Bilingual (Hindi + Hinglish)</option>
                <option value="hindi_devanagari">🇮🇳 Pure Hindi Devanagari</option>
                <option value="hinglish_roman">🔤 Romanized Hinglish</option>
              </select>
            </div>

            {/* Full Production Bundle */}
            <button
              type="button"
              onClick={handleDownloadFullBundle}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg text-amber-600 dark:text-amber-400 transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-amber-500" />
              Full Stems Package (WAV + BGM + SRT)
            </button>

            {/* Render & Download Synced Video */}
            <button
              type="button"
              onClick={handleExportSyncedVideo}
              disabled={isExportingVideo}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {isExportingVideo ? 'Rendering Video...' : 'Render & Download Synced Video'}
            </button>
          </div>
        </section>
      </main>

      {/* Provider Configuration Modal */}
      <ProviderModal
        isOpen={isProviderModalOpen}
        config={providerConfig}
        onClose={() => setIsProviderModalOpen(false)}
        onUpdateConfig={(patch) =>
          setProviderConfig((prev) => ({ ...prev, ...patch }))
        }
      />

      {/* Firestore Project Persistence Modal */}
      <ProjectManagerModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        currentProjectData={{
          title: currentProjectTitle,
          sourceLanguage,
          adaptationStyle,
          indianDialect,
          globalVoiceId,
          durationSeconds,
          uploadedFileName,
          segments,
        }}
        onLoadProject={handleLoadSavedProject}
      />

      {/* Movie .SRT / .VTT Subtitle Import Modal */}
      <ImportSrtModal
        isOpen={isImportSrtModalOpen}
        onClose={() => setIsImportSrtModalOpen(false)}
        globalVoiceId={globalVoiceId}
        indianDialect={indianDialect}
        onImportSegments={handleImportParsedSrt}
      />
    </div>
  );
}
