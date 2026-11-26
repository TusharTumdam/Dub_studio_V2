import React, { useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  Volume2,
  RefreshCw,
  Download,
  Plus,
  Trash2,
  Check,
  AlertTriangle,
  Mic,
  Globe,
  Wind,
  Users,
  Lock,
  Play,
  Square,
  Zap,
} from 'lucide-react';
import {
  AdaptationStyle,
  DubbingSegment,
  EMOTION_PRESETS,
  GeminiVoiceId,
  GLOBAL_SOURCE_LANGUAGES,
  GlobalSourceLanguage,
  INDIAN_VOCAL_DIALECTS,
  IndianVocalDialect,
  VOICE_PERSONAS,
} from '../types/dubbing';
import { countSyllables, formatTimecode } from '../utils/audioEngine';

interface ScriptStudioProps {
  segments: DubbingSegment[];
  sourceLanguage: GlobalSourceLanguage;
  adaptationStyle: AdaptationStyle;
  indianDialect: IndianVocalDialect;
  globalVoiceId: GeminiVoiceId;
  isTranslatingAll: boolean;
  isSynthesizingAll: boolean;
  currentTime: number;
  onChangeSourceLanguage: (lang: GlobalSourceLanguage) => void;
  onChangeAdaptationStyle: (style: AdaptationStyle) => void;
  onChangeIndianDialect: (dialect: IndianVocalDialect) => void;
  onChangeGlobalVoice: (voiceId: GeminiVoiceId) => void;
  onTranslateAll: (styleOverride?: AdaptationStyle, dialectOverride?: IndianVocalDialect) => void;
  onSynthesizeAllVoices: () => void;
  onUpdateSegment: (id: string, patch: Partial<DubbingSegment>) => void;
  onRetranslateSegment: (segment: DubbingSegment) => void;
  onSynthesizeSingleSegment: (segment: DubbingSegment) => void;
  onPlaySegmentAudio: (segment: DubbingSegment) => void;
  onAddSegment: () => void;
  onDeleteSegment: (id: string) => void;
  onSeekToSegment: (startTime: number) => void;
}

const STYLE_TABS: Array<{ id: AdaptationStyle; label: string }> = [
  { id: 'bollywood_cinematic', label: 'Bollywood Cinema' },
  { id: 'ott_natural_realism', label: 'Realistic Indian OTT' },
  { id: 'conversational_hinglish', label: 'Urban Hinglish' },
  { id: 'poetic_hindustani', label: 'Poetic Hindustani' },
];

const QUICK_EMOTIONS = [
  {
    label: '😂 हँसना (Laugh)',
    tag: '<laugh>',
    hindiPrefix: '<laugh> हा हा! ',
    prompt: 'Laughing warmly: Burst into genuine joyful laughter <laugh>, audible chuckles and playful giggles while speaking',
  },
  {
    label: '😭 रोना (Cry / Sob)',
    tag: '<sob>',
    hindiPrefix: '<sob> आह... ',
    prompt: 'Crying & weeping: Heartbroken crying through real tears <sob>, choked sobbing voice and sorrowful emotional trembling',
  },
  {
    label: '😡 गुस्सा (Furious Anger)',
    tag: '<angry>',
    hindiPrefix: '<angry> ',
    prompt: 'Furious anger & rage: Boiling with intense fury <angry>, aggressively shouting with fierce harsh conviction',
  },
  {
    label: '😱 चौंकना (Gasp / Shock)',
    tag: '<gasp>',
    hindiPrefix: '<gasp> अरे! ',
    prompt: 'Terrified shock & gasp: Sudden sharp breathless gasp <gasp>, panicking and trembling in deep fear',
  },
  {
    label: '😮‍💨 गहरी आह (Deep Sigh)',
    tag: '<sigh>',
    hindiPrefix: '<sigh> ',
    prompt: 'Deep emotional sigh: Releasing an audible heavy sigh of relief and exhaustion <sigh> before speaking',
  },
  {
    label: '🤫 फुसफुसाना (Whisper)',
    tag: '<whisper>',
    hindiPrefix: '<whisper> ',
    prompt: 'Intense dramatic whisper: Secretive, thrilling close-to-mic cinematic whisper <whisper>',
  },
  {
    label: '🎬 Cinema Normal',
    tag: '',
    hindiPrefix: '',
    prompt: 'Mumbai studio cinema standard lead dialog delivery with natural warm pauses',
  },
];

export const ScriptStudio: React.FC<ScriptStudioProps> = ({
  segments,
  sourceLanguage,
  adaptationStyle,
  indianDialect,
  globalVoiceId,
  isTranslatingAll,
  isSynthesizingAll,
  currentTime,
  onChangeSourceLanguage,
  onChangeAdaptationStyle,
  onChangeIndianDialect,
  onChangeGlobalVoice,
  onTranslateAll,
  onSynthesizeAllVoices,
  onUpdateSegment,
  onRetranslateSegment,
  onSynthesizeSingleSegment,
  onPlaySegmentAudio,
  onAddSegment,
  onDeleteSegment,
  onSeekToSegment,
}) => {
  const [auditioningVoiceId, setAuditioningVoiceId] = useState<string | null>(null);
  const auditionAudioRef = useRef<HTMLAudioElement | null>(null);

  const uniqueCharacters = useMemo(() => {
    const map = new Map<
      string,
      {
        speaker: string;
        gender: 'male' | 'female';
        voiceId: GeminiVoiceId;
        count: number;
        duration: number;
      }
    >();

    for (const seg of segments) {
      const spk = (seg.speaker || 'Character 1').trim();
      const dur = Math.max(0.5, seg.endTime - seg.startTime);
      const existing = map.get(spk.toLowerCase());
      if (existing) {
        existing.count += 1;
        existing.duration += dur;
      } else {
        map.set(spk.toLowerCase(), {
          speaker: spk,
          gender: seg.gender || 'male',
          voiceId: seg.voiceId || (seg.gender === 'female' ? 'Kore' : 'Charon'),
          count: 1,
          duration: dur,
        });
      }
    }
    return Array.from(map.values());
  }, [segments]);

  const handleUpdateCharacterGlobally = (
    originalSpeaker: string,
    patch: { voiceId?: GeminiVoiceId; gender?: 'male' | 'female'; newSpeaker?: string }
  ) => {
    const target = originalSpeaker.trim().toLowerCase();
    for (const s of segments) {
      if (s.speaker.trim().toLowerCase() === target) {
        onUpdateSegment(s.id, {
          ...(patch.voiceId ? { voiceId: patch.voiceId } : {}),
          ...(patch.gender ? { gender: patch.gender } : {}),
          ...(patch.newSpeaker ? { speaker: patch.newSpeaker } : {}),
        });
      }
    }
  };

  const playVoiceAudition = async (voiceId: GeminiVoiceId) => {
    if (auditioningVoiceId === voiceId && auditionAudioRef.current) {
      auditionAudioRef.current.pause();
      setAuditioningVoiceId(null);
      return;
    }
    setAuditioningVoiceId(voiceId);
    try {
      const res = await fetch('/api/dubbing/audition-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId }),
      });
      const data = await res.json();
      if (data?.audioBase64) {
        if (auditionAudioRef.current) {
          auditionAudioRef.current.pause();
        }
        const audio = new Audio(`data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`);
        auditionAudioRef.current = audio;
        audio.onended = () => setAuditioningVoiceId(null);
        audio.onerror = () => setAuditioningVoiceId(null);
        await audio.play();
      } else {
        setAuditioningVoiceId(null);
      }
    } catch {
      setAuditioningVoiceId(null);
    }
  };

  const downloadSegmentWav = (seg: DubbingSegment) => {
    if (!seg.generatedWavBase64) return;
    const ext = seg.generatedMimeType === 'audio/mpeg' ? 'mp3' : 'wav';
    const link = document.createElement('a');
    link.href = `data:${seg.generatedMimeType || 'audio/wav'};base64,${seg.generatedWavBase64}`;
    link.download = `chitravani_indian_voice_seg_${seg.index + 1}.${ext}`;
    link.click();
  };

  const insertHumanCueIntoHindi = (
    seg: DubbingSegment,
    cue: string,
    optionalEmotionPrompt?: string
  ) => {
    const current = seg.hindiDevanagari.trim();
    const updated = current.includes(cue) ? current : `${cue} ${current}`.trim();
    onUpdateSegment(seg.id, {
      hindiDevanagari: updated,
      humanBreathEnabled: true,
      ...(optionalEmotionPrompt ? { emotionPrompt: optionalEmotionPrompt } : {}),
    });
  };

  return (
    <section className="flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
      {/* Studio Script Header & Style Adaptation Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Global Language to Realistic Indian Hindi Dubbing Studio
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            13+ global source languages · Native Indian human breath, cadence & retroflex diction
          </p>
        </div>

        {/* Adaptation Style Segmented Control */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
          {STYLE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                onChangeAdaptationStyle(tab.id);
                onTranslateAll(tab.id, indianDialect);
              }}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                adaptationStyle === tab.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Global Source Language + Indian Human Voice Persona & Dialect Bar */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 px-4 py-3 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 items-center">
        {/* Global Source Language Selector */}
        <div className="md:col-span-4 flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <label className="block text-[10px] text-slate-500 dark:text-slate-400">
              Global Source Language (Input)
            </label>
            <select
              aria-label="Global Source Language"
              value={sourceLanguage}
              onChange={(e) => onChangeSourceLanguage(e.target.value as GlobalSourceLanguage)}
              className="w-full px-2 py-1 text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
            >
              {GLOBAL_SOURCE_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label} ({lang.nativeName})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Indian Human Voice Artist Selector */}
        <div className="md:col-span-4">
          <label className="block text-[10px] text-slate-500 dark:text-slate-400">
            Realistic Indian Human Voice Artist
          </label>
          <select
            aria-label="Lead Indian Human Voice Persona"
            value={globalVoiceId}
            onChange={(e) => onChangeGlobalVoice(e.target.value as GeminiVoiceId)}
            className="w-full px-2 py-1 text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
          >
            {VOICE_PERSONAS.map((vp) => (
              <option key={vp.id} value={vp.id}>
                {vp.hindiName} — {vp.archetype}
              </option>
            ))}
          </select>
        </div>

        {/* Indian Regional Accent & Vocal Nuance */}
        <div className="md:col-span-4">
          <label className="block text-[10px] text-slate-500 dark:text-slate-400">
            Indian Vocal Diction & Regional Nuance
          </label>
          <select
            aria-label="Indian Vocal Dialect Nuance"
            value={indianDialect}
            onChange={(e) => {
              const nextDialect = e.target.value as IndianVocalDialect;
              onChangeIndianDialect(nextDialect);
            }}
            className="w-full px-2 py-1 text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
          >
            {INDIAN_VOCAL_DIALECTS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Character Voice Casting Deck & Indian Actor Auditions */}
      {uniqueCharacters.length > 0 && (
        <div className="px-4 py-3 bg-amber-500/[0.04] dark:bg-amber-500/[0.03] border-b border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-500 shrink-0" />
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                Character Voice Casting & Audition Deck ({uniqueCharacters.length} Distinct Characters)
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
              <Lock className="w-3.5 h-3.5" />
              <span>Voice Identity 100% Locked Across Full Video</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {uniqueCharacters.map((char) => {
              const persona = VOICE_PERSONAS.find((p) => p.id === char.voiceId);
              const isAuditioning = auditioningVoiceId === char.voiceId;
              return (
                <div
                  key={char.speaker}
                  className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex flex-col justify-between gap-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm">
                        {char.gender === 'female' ? '👩' : '👨'}
                      </span>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                        {char.speaker}
                      </span>
                    </div>
                    <span className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded">
                      {char.count} cues · {char.duration.toFixed(1)}s
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Voice selector for this character */}
                    <select
                      aria-label={`Assigned voice for ${char.speaker}`}
                      value={char.voiceId}
                      onChange={(e) => {
                        const newV = e.target.value as GeminiVoiceId;
                        const p = VOICE_PERSONAS.find((vp) => vp.id === newV);
                        handleUpdateCharacterGlobally(char.speaker, {
                          voiceId: newV,
                          gender: p?.gender || char.gender,
                        });
                      }}
                      className="flex-1 px-2 py-1 text-xs font-medium bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-500"
                    >
                      <optgroup label="👨 Male Character Voices">
                        {VOICE_PERSONAS.filter((v) => v.gender === 'male').map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.hindiName} ({v.archetype})
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="👩 Female Character Voices">
                        {VOICE_PERSONAS.filter((v) => v.gender === 'female').map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.hindiName} ({v.archetype})
                          </option>
                        ))}
                      </optgroup>
                    </select>

                    {/* Audition Button */}
                    <button
                      type="button"
                      onClick={() => playVoiceAudition(char.voiceId)}
                      title={`Audition sample line for ${persona?.hindiName || char.voiceId}`}
                      className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded border transition-colors shrink-0 ${
                        isAuditioning
                          ? 'bg-amber-500 text-slate-950 border-amber-500 animate-pulse'
                          : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {isAuditioning ? (
                        <>
                          <Square className="w-3 h-3 fill-current" />
                          <span>Playing</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 fill-current" />
                          <span>Audition</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Action Strip for Batch Adaptation & Realistic Indian TTS */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-slate-100/70 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800">
        <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2">
          <Wind className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span>
            Human Breath & Pause Tags (<code className="font-mono text-amber-600 dark:text-amber-400">&lt;breath&gt;</code>,{' '}
            <code className="font-mono text-amber-600 dark:text-amber-400">&lt;sigh&gt;</code>,{' '}
            <code className="font-mono text-amber-600 dark:text-amber-400">...</code>) active for natural Indian vocal realism
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onTranslateAll()}
            disabled={isTranslatingAll || segments.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTranslatingAll ? 'animate-spin text-amber-500' : ''}`} />
            {isTranslatingAll ? 'Adapting to Hindi...' : 'Adapt Global Script to Hindi'}
          </button>

          <button
            type="button"
            onClick={onSynthesizeAllVoices}
            disabled={isSynthesizingAll || segments.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Mic className={`w-3.5 h-3.5 ${isSynthesizingAll ? 'animate-bounce' : ''}`} />
            {isSynthesizingAll ? 'Synthesizing Indian Voices...' : 'Synthesize Realistic Indian Voice (.wav)'}
          </button>
        </div>
      </div>

      {/* Segment Rows List */}
      <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[520px] overflow-y-auto">
        {segments.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              No dialogue segments loaded yet. Extract audio from any global video or add a dialogue cue to begin dubbing.
            </p>
            <button
              type="button"
              onClick={onAddSegment}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-amber-500 text-slate-950 rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              Add First Dialogue Cue
            </button>
          </div>
        ) : (
          segments.map((seg) => {
            const isCurrent = currentTime >= seg.startTime && currentTime <= seg.endTime;
            const windowDuration = Math.max(0.5, seg.endTime - seg.startTime);
            const engSyl = seg.englishSyllables || countSyllables(seg.englishText);
            const hinSyl = seg.hindiSyllables || countSyllables(seg.hindiDevanagari || seg.hinglishRoman);
            const syllableRatio = engSyl > 0 ? hinSyl / engSyl : 1;
            const isPacingTight = syllableRatio >= 0.72 && syllableRatio <= 1.28;

            return (
              <div
                key={seg.id}
                className={`p-4 transition-colors space-y-3 ${
                  isCurrent
                    ? 'bg-amber-500/[0.06] dark:bg-amber-500/[0.07]'
                    : 'hover:bg-slate-50/70 dark:hover:bg-slate-950/40'
                }`}
              >
                {/* Row Top Metadata Bar (Character Name, Gender Toggle, Timecode, Syllables) */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    <button
                      type="button"
                      onClick={() => onSeekToSegment(seg.startTime)}
                      className="font-semibold text-amber-600 dark:text-amber-400 hover:underline whitespace-nowrap"
                    >
                      {formatTimecode(seg.startTime)} – {formatTimecode(seg.endTime)}
                    </button>
                    <span aria-hidden="true">·</span>
                    <span>{windowDuration.toFixed(1)}s</span>
                    <span aria-hidden="true">·</span>

                    {/* Character Speaker & Gender Badge */}
                    <div className="flex items-center gap-1.5 font-sans">
                      <input
                        type="text"
                        value={seg.speaker}
                        onChange={(e) => onUpdateSegment(seg.id, { speaker: e.target.value })}
                        className="w-24 sm:w-28 px-1.5 py-0.5 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-500"
                        title="Character / Speaker Name"
                        placeholder="Character"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const nextGender = (seg.gender || 'male') === 'male' ? 'female' : 'male';
                          const nextVoice = nextGender === 'female' ? 'Kore' : 'Charon';
                          onUpdateSegment(seg.id, {
                            gender: nextGender,
                            voiceId: nextVoice,
                          });
                        }}
                        className={`px-1.5 py-0.5 text-[11px] font-semibold rounded border transition-colors flex items-center gap-1 ${
                          (seg.gender || 'male') === 'female'
                            ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25'
                            : 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25'
                        }`}
                        title="Click to toggle character gender (Male / Female)"
                      >
                        {(seg.gender || 'male') === 'female' ? '👩 Female' : '👨 Male'}
                      </button>
                    </div>

                    <span aria-hidden="true">·</span>
                    <span
                      className={`inline-flex items-center gap-1 font-sans ${
                        isPacingTight
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {isPacingTight ? (
                        <Check className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      )}
                      {hinSyl} HI / {engSyl} Src syllables
                    </span>
                  </div>

                  {/* Per-Segment Action Controls */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      aria-label={`Voice for character ${seg.speaker}`}
                      value={seg.voiceId}
                      onChange={(e) => {
                        const newVoice = e.target.value as GeminiVoiceId;
                        const persona = VOICE_PERSONAS.find((p) => p.id === newVoice);
                        onUpdateSegment(seg.id, {
                          voiceId: newVoice,
                          gender: persona?.gender || seg.gender,
                        });
                      }}
                      className="px-2 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-500"
                    >
                      <optgroup label="👨 Male Character Voices">
                        {VOICE_PERSONAS.filter((v) => v.gender === 'male').map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.hindiName}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="👩 Female Character Voices">
                        {VOICE_PERSONAS.filter((v) => v.gender === 'female').map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.hindiName}
                          </option>
                        ))}
                      </optgroup>
                    </select>

                    <button
                      type="button"
                      onClick={() => onRetranslateSegment(seg)}
                      disabled={seg.isTranslating}
                      title="Regenerate natural Indian Hindi adaptation"
                      className="px-2.5 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
                    >
                      {seg.isTranslating ? 'Adapting...' : 'Re-Adapt'}
                    </button>

                    <button
                      type="button"
                      onClick={() => onSynthesizeSingleSegment(seg)}
                      disabled={seg.isSynthesizing}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded text-amber-700 dark:text-amber-300 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Zap className={`w-3 h-3 ${seg.isSynthesizing ? 'animate-bounce text-amber-500' : ''}`} />
                      {seg.isSynthesizing
                        ? 'Dubbing...'
                        : seg.generatedWavBase64
                        ? 'Re-Dub Line'
                        : 'Quick Dub Line'}
                    </button>

                    {seg.generatedWavBase64 && (
                      <>
                        <button
                          type="button"
                          onClick={() => onPlaySegmentAudio(seg)}
                          title="Audition synthesized realistic Indian Hindi WAV"
                          className="p-1.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 transition-colors"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadSegmentWav(seg)}
                          title="Download segment .wav"
                          className="p-1.5 rounded bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => onDeleteSegment(seg.id)}
                      title="Delete segment"
                      className="p-1.5 rounded hover:bg-rose-500/10 text-slate-400 hover:text-rose-500 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* 3-Column Script Grid: Global Source | Hindi Devanagari + Human Breath Cues | Romanized Hinglish */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Global Source Transcript ({seg.detectedLanguage || 'Auto-Detect'})
                    </label>
                    <textarea
                      rows={2}
                      value={seg.englishText}
                      onChange={(e) =>
                        onUpdateSegment(seg.id, {
                          englishText: e.target.value,
                          englishSyllables: countSyllables(e.target.value),
                        })
                      }
                      className="w-full px-3 py-2 text-xs leading-relaxed bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-500 resize-none"
                    />
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                      <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Realistic Indian Hindi (Devanagari Master + Reactions)
                      </label>
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            insertHumanCueIntoHindi(
                              seg,
                              '<laugh> हा हा!',
                              'Laughing warmly: Burst into genuine joyful laughter <laugh>, audible chuckles and giggles'
                            )
                          }
                          title="Insert genuine human laughter (हँसना)"
                          className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded transition-colors"
                        >
                          😂 +हँसना
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            insertHumanCueIntoHindi(
                              seg,
                              '<sob> आह...',
                              'Crying & weeping: Heartbroken crying through real tears <sob>, choked sobbing voice'
                            )
                          }
                          title="Insert emotional crying / sobbing (रोना)"
                          className="px-1.5 py-0.5 text-[10px] font-medium bg-sky-500/10 hover:bg-sky-500/25 text-sky-600 dark:text-sky-400 border border-sky-500/20 rounded transition-colors"
                        >
                          😭 +रोना
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            insertHumanCueIntoHindi(
                              seg,
                              '<angry>',
                              'Furious anger & rage: Boiling with intense fury <angry>, aggressively shouting with fierce force'
                            )
                          }
                          title="Insert fierce anger & rage (गुस्सा)"
                          className="px-1.5 py-0.5 text-[10px] font-medium bg-rose-500/10 hover:bg-rose-500/25 text-rose-600 dark:text-rose-400 border border-rose-500/20 rounded transition-colors"
                        >
                          😡 +गुस्सा
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            insertHumanCueIntoHindi(
                              seg,
                              '<gasp> अरे!',
                              'Terrified shock & gasp: Sudden sharp breathless gasp <gasp>, panicking in shock'
                            )
                          }
                          title="Insert sudden shock gasp (चौंकना)"
                          className="px-1.5 py-0.5 text-[10px] font-medium bg-purple-500/10 hover:bg-purple-500/25 text-purple-600 dark:text-purple-400 border border-purple-500/20 rounded transition-colors"
                        >
                          😱 +चौंकना
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            insertHumanCueIntoHindi(
                              seg,
                              '<sigh>',
                              'Deep emotional sigh: Releasing an audible heavy sigh of relief and exhaustion <sigh>'
                            )
                          }
                          title="Insert emotional human sigh (गहरी आह)"
                          className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 dark:bg-slate-800 hover:bg-amber-500/20 text-slate-600 dark:text-slate-300 rounded transition-colors"
                        >
                          😮‍💨 +आह
                        </button>
                      </div>
                    </div>
                    <textarea
                      rows={2}
                      value={seg.hindiDevanagari}
                      onChange={(e) =>
                        onUpdateSegment(seg.id, {
                          hindiDevanagari: e.target.value,
                          hindiSyllables: countSyllables(e.target.value),
                        })
                      }
                      className="w-full px-3 py-2 text-xs leading-relaxed bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:border-amber-500 resize-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Romanized Hinglish & Phonetic Guide
                    </label>
                    <textarea
                      rows={2}
                      value={seg.hinglishRoman}
                      onChange={(e) =>
                        onUpdateSegment(seg.id, {
                          hinglishRoman: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 text-xs leading-relaxed bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-none focus:border-amber-500 resize-none"
                    />
                  </div>
                </div>

                {/* Vocal Acting & Indian Human Inflection Bar */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                    Indian Voice Acting Direction:
                  </span>
                  <input
                    type="text"
                    value={seg.emotionPrompt}
                    onChange={(e) => onUpdateSegment(seg.id, { emotionPrompt: e.target.value })}
                    placeholder="e.g., Natural Indian human voice with subtle breath and warm Mumbai cinema inflection..."
                    className="flex-1 min-w-[200px] px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-slate-700 dark:text-slate-300 focus:outline-none focus:border-amber-500"
                  />
                  <select
                    aria-label="Preset Indian Vocal Emotion"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        onUpdateSegment(seg.id, { emotionPrompt: e.target.value });
                      }
                    }}
                    className="px-2 py-1 text-xs bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-slate-600 dark:text-slate-400"
                  >
                    <option value="">Human Realism Presets...</option>
                    {EMOTION_PRESETS.map((preset) => (
                      <option key={preset} value={preset}>
                        {preset.slice(0, 52)}...
                      </option>
                    ))}
                  </select>
                </div>

                {/* Character Reaction & Vocal Emotion Bar (Hansna, Rona, Gussa, Shock) */}
                <div className="flex flex-wrap items-center gap-1.5 pl-5 pt-0.5">
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 uppercase tracking-wider font-bold mr-0.5">
                    Vocal Reaction:
                  </span>
                  {QUICK_EMOTIONS.map((chip) => {
                    const isActive =
                      (chip.tag && seg.hindiDevanagari.includes(chip.tag)) ||
                      seg.emotionPrompt === chip.prompt;
                    return (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => {
                          const cleanExisting = seg.hindiDevanagari
                            .replace(/<(laugh|sob|cry|angry|gasp|sigh|whisper|breath)>\s*(हा हा!|आह\.\.\.|अरे!)?\s*/gi, '')
                            .trim();
                          const nextHindi = chip.hindiPrefix
                            ? `${chip.hindiPrefix}${cleanExisting}`
                            : cleanExisting;
                          onUpdateSegment(seg.id, {
                            hindiDevanagari: nextHindi,
                            emotionPrompt: chip.prompt,
                            humanBreathEnabled: true,
                          });
                        }}
                        className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-full border transition-colors ${
                          isActive
                            ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-xs'
                            : 'bg-slate-100 dark:bg-slate-800 hover:bg-amber-500/15 hover:border-amber-500/30 text-slate-700 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-400 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Add Line Bar */}
      <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          Total Cues: {segments.length} · Synthesized Indian WAVs:{' '}
          {segments.filter((s) => Boolean(s.generatedWavBase64)).length}/{segments.length}
        </span>
        <button
          type="button"
          onClick={onAddSegment}
          className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5 text-amber-500" />
          Add Timecoded Cue
        </button>
      </div>
    </section>
  );
};
