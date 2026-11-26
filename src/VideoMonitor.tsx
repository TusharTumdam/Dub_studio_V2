import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Upload,
  Volume2,
  VolumeX,
  Subtitles,
  Sliders,
  Film,
} from 'lucide-react';
import {
  AudioMixConfig,
  DubbingSegment,
  SampleReelPreset,
  STUDIO_SAMPLE_REELS,
} from '../types/dubbing';
import { formatTimecode } from '../utils/audioEngine';

interface VideoMonitorProps {
  sourceType: 'sample' | 'upload';
  selectedReel: SampleReelPreset;
  uploadedVideoUrl: string | null;
  uploadedFileName: string | null;
  durationSeconds: number;
  currentTime: number;
  isPlaying: boolean;
  audioMode: 'hindi_master' | 'english_original';
  subtitlesMode: 'hindi' | 'hinglish' | 'bilingual' | 'off';
  lipSyncOverlayEnabled: boolean;
  mixConfig: AudioMixConfig;
  segments: DubbingSegment[];
  hasHindiAudio: boolean;
  onSelectSampleReel: (reel: SampleReelPreset) => void;
  onUploadVideoFile: (file: File) => void;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onChangeAudioMode: (mode: 'hindi_master' | 'english_original') => void;
  onChangeSubtitlesMode: (mode: 'hindi' | 'hinglish' | 'bilingual' | 'off') => void;
  onToggleLipSyncOverlay: () => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

const VISEME_LABELS = ['REST', 'MBP (प/ब/म)', 'AA (आ)', 'EE (ई)', 'OH (ओ)', 'OO (ऊ)', 'FV (व/फ़)'];

export const VideoMonitor: React.FC<VideoMonitorProps> = ({
  sourceType,
  selectedReel,
  uploadedVideoUrl,
  uploadedFileName,
  durationSeconds,
  currentTime,
  isPlaying,
  audioMode,
  subtitlesMode,
  lipSyncOverlayEnabled,
  mixConfig,
  segments,
  hasHindiAudio,
  onSelectSampleReel,
  onUploadVideoFile,
  onTogglePlay,
  onSeek,
  onChangeAudioMode,
  onChangeSubtitlesMode,
  onToggleLipSyncOverlay,
  canvasRef,
  videoRef,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [mouthAnchor, setMouthAnchor] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.56 });

  const activeSegment = segments.find(
    (s) => currentTime >= s.startTime && currentTime <= s.endTime
  );

  // Pure derived mouth opening & viseme state from active dialogue segment and timestamp (no setState inside useEffect)
  let mouthOpen = 0.04;
  let mouthWidth = 0.36;
  let visemeIdx = 0;

  if (activeSegment) {
    const segProgress =
      (currentTime - activeSegment.startTime) /
      Math.max(0.2, activeSegment.endTime - activeSegment.startTime);
    const textToAnalyze =
      audioMode === 'hindi_master'
        ? activeSegment.hinglishRoman || activeSegment.englishText
        : activeSegment.englishText;

    const charIdx = Math.min(
      textToAnalyze.length - 1,
      Math.max(0, Math.floor(segProgress * textToAnalyze.length))
    );
    const ch = (textToAnalyze[charIdx] || ' ').toLowerCase();
    const warpFactor = Math.max(0.2, mixConfig.lipSyncWarpIntensity / 100);
    const syllabicPulse = Math.abs(Math.sin(currentTime * 15.5));

    if ('mbpपबम'.includes(ch)) {
      mouthOpen = 0.02;
      mouthWidth = 0.42;
      visemeIdx = 1;
    } else if ('aआ'.includes(ch)) {
      mouthOpen = (0.48 + 0.25 * syllabicPulse) * warpFactor;
      mouthWidth = 0.45;
      visemeIdx = 2;
    } else if ('eiईए'.includes(ch)) {
      mouthOpen = (0.28 + 0.18 * syllabicPulse) * warpFactor;
      mouthWidth = 0.52;
      visemeIdx = 3;
    } else if ('oओ'.includes(ch)) {
      mouthOpen = (0.44 + 0.2 * syllabicPulse) * warpFactor;
      mouthWidth = 0.3;
      visemeIdx = 4;
    } else if ('uऊउ'.includes(ch)) {
      mouthOpen = (0.32 + 0.15 * syllabicPulse) * warpFactor;
      mouthWidth = 0.25;
      visemeIdx = 5;
    } else if ('fvवफ'.includes(ch)) {
      mouthOpen = 0.14 * warpFactor;
      mouthWidth = 0.4;
      visemeIdx = 6;
    } else if (ch !== ' ') {
      mouthOpen = (0.22 + 0.24 * syllabicPulse) * warpFactor;
      mouthWidth = 0.38;
      visemeIdx = 2;
    }
  }

  const activeViseme = VISEME_LABELS[visemeIdx];

  // Render procedural cinema frame or composite uploaded video frame + Lip-Sync Viseme calibration onto canvasRef
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // When playing or exporting an uploaded video with lipSyncOverlay disabled, never clear canvasRef (used by .webm video export stream)
    if (sourceType === 'upload' && !lipSyncOverlayEnabled) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (sourceType === 'upload' && videoRef.current && uploadedVideoUrl) {
      const cx = w * mouthAnchor.x;
      const cy = h * mouthAnchor.y;
      ctx.save();
      ctx.strokeStyle = audioMode === 'hindi_master' ? '#10B981' : '#F59E0B';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.ellipse(
        cx,
        cy,
        w * 0.045 * (0.85 + mouthWidth * 0.4),
        h * 0.022 * (0.7 + mouthOpen * 1.4),
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      ctx.restore();
      return;
    } else {
      // Render Professional Cinema Dubbing Studio Monitor & Voice-Reactive Acoustic Visualizer
      const bgGrad = ctx.createLinearGradient(0, 0, w, h);
      if (selectedReel.id === 'scifi-trailer') {
        bgGrad.addColorStop(0, '#050811');
        bgGrad.addColorStop(0.5, '#0B1325');
        bgGrad.addColorStop(1, '#13112E');
      } else if (selectedReel.id === 'creator-tech') {
        bgGrad.addColorStop(0, '#060D17');
        bgGrad.addColorStop(0.6, '#0A1926');
        bgGrad.addColorStop(1, '#062019');
      } else {
        bgGrad.addColorStop(0, '#12090F');
        bgGrad.addColorStop(0.6, '#19101E');
        bgGrad.addColorStop(1, '#1F1115');
      }
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Subtle studio radial aura reacting to active voice energy
      const energyPulse = activeSegment ? 0.16 + mouthOpen * 0.25 : 0.08;
      const glowGrad = ctx.createRadialGradient(
        w * 0.5,
        h * 0.44,
        16,
        w * 0.5,
        h * 0.44,
        w * 0.48
      );
      glowGrad.addColorStop(
        0,
        audioMode === 'hindi_master'
          ? `rgba(245, 158, 11, ${energyPulse})`
          : `rgba(56, 189, 248, ${energyPulse})`
      );
      glowGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, w, h);

      // Precision studio acoustic grid lines
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
      ctx.lineWidth = 1;
      for (let gx = 60; gx < w; gx += 60) {
        ctx.beginPath();
        ctx.moveTo(gx, h * 0.08);
        ctx.lineTo(gx, h * 0.92);
        ctx.stroke();
      }
      for (let gy = 50; gy < h; gy += 50) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      // Anamorphic cinema letterbox bars
      ctx.fillStyle = '#04060A';
      ctx.fillRect(0, 0, w, h * 0.08);
      ctx.fillRect(0, h * 0.92, w, h * 0.08);

      const centerX = w * 0.5;
      const centerY = h * 0.42;

      // Active Speaker & Gender / Voice Identity HUD Card
      const speakerName = activeSegment?.speaker || selectedReel.visualTheme.characterName;
      const speakerGender =
        activeSegment?.gender ||
        (/female|dr\.|priya|ananya|kavya|narrator/i.test(speakerName) ? 'female' : 'male');
      const lockedVoiceName =
        activeSegment?.voiceId || (speakerGender === 'female' ? 'Kore' : 'Charon');
      const emotionText = activeSegment?.emotionPrompt || 'Cinematic Studio Delivery';

      // Concentric Acoustic Resonance Rings
      const ringRadiusBase = 56;
      for (let r = 0; r < 3; r++) {
        const dynRadius =
          ringRadiusBase + r * 18 + (activeSegment ? mouthOpen * (22 + r * 10) : 0);
        ctx.beginPath();
        ctx.arc(centerX, centerY - 18, dynRadius, 0, Math.PI * 2);
        ctx.strokeStyle =
          audioMode === 'hindi_master'
            ? `rgba(245, 158, 11, ${0.38 - r * 0.11})`
            : `rgba(56, 189, 248, ${0.35 - r * 0.1})`;
        ctx.lineWidth = r === 0 ? 2.2 : 1.2;
        ctx.stroke();
      }

      // Core Studio Microphone / Character Emblem Circle
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.beginPath();
      ctx.arc(centerX, centerY - 18, 48, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = audioMode === 'hindi_master' ? '#F59E0B' : '#38BDF8';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Speaker Initials / Gender Badge inside Core Emblem
      ctx.textAlign = 'center';
      ctx.fillStyle = '#F8FAFC';
      ctx.font = '700 18px "Syne", sans-serif';
      const initials = speakerName
        .replace(/[^a-zA-Z ]/g, '')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0])
        .join('')
        .toUpperCase() || 'CV';
      ctx.fillText(initials, centerX, centerY - 16);

      ctx.fillStyle = speakerGender === 'female' ? '#F472B6' : '#38BDF8';
      ctx.font = '600 9px "JetBrains Mono", monospace';
      ctx.fillText(
        speakerGender === 'female' ? 'FEMALE LEAD' : 'MALE LEAD',
        centerX,
        centerY - 2
      );

      // Character & Locked Voice Metadata Pill
      ctx.fillStyle = '#F8FAFC';
      ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(
        `${speakerName}  ·  Voice: ${lockedVoiceName} (Locked)`,
        centerX,
        centerY + 52
      );

      ctx.fillStyle = '#F59E0B';
      ctx.font = '500 11px "JetBrains Mono", monospace';
      const shortEmotion =
        emotionText.length > 68 ? emotionText.slice(0, 65) + '...' : emotionText;
      ctx.fillText(`🎭 ${shortEmotion}`, centerX, centerY + 70);

      // 48-Bar Dynamic Studio Vocal Frequency Visualizer (synchronized with voice & visemes)
      const numBars = 48;
      const barAreaWidth = w * 0.68;
      const startX = (w - barAreaWidth) / 2;
      const barStep = barAreaWidth / numBars;
      const barBaseY = h * 0.65;

      for (let b = 0; b < numBars; b++) {
        const distFromCenter = Math.abs(b - numBars / 2) / (numBars / 2);
        const bellCurve = Math.max(0.15, 1 - distFromCenter * distFromCenter);
        const wave1 = Math.abs(Math.sin(currentTime * 11 + b * 0.45));
        const wave2 = Math.abs(Math.cos(currentTime * 7.3 - b * 0.3));
        const activeBoost = activeSegment ? 0.25 + mouthOpen * 1.45 : 0.06;
        const barHeight = Math.max(
          3,
          (8 + (wave1 * 28 + wave2 * 18) * activeBoost) * bellCurve
        );

        const bx = startX + b * barStep;
        ctx.fillStyle =
          audioMode === 'hindi_master'
            ? activeSegment
              ? '#F59E0B'
              : 'rgba(245, 158, 11, 0.3)'
            : activeSegment
            ? '#38BDF8'
            : 'rgba(56, 189, 248, 0.3)';
        ctx.fillRect(bx, barBaseY - barHeight / 2, Math.max(2, barStep - 3), barHeight);
      }

      // Top timecode & camera metadata overlay inside video frame
      ctx.fillStyle = 'rgba(248, 250, 252, 0.85)';
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(
        `${selectedReel.visualTheme.sceneLabel} · ${
          audioMode === 'hindi_master' ? 'HINDI 24kHz MASTER' : 'ORIGINAL SOURCE'
        }`,
        18,
        22
      );
      ctx.textAlign = 'right';
      ctx.fillText(
        `TC ${formatTimecode(currentTime)} / ${formatTimecode(durationSeconds)}`,
        w - 18,
        22
      );
      ctx.textAlign = 'left';
    }

    // Subtitle Burn-In Overlay on Video Canvas (so exported videos also include optional burned-in subtitles)
    if (activeSegment && subtitlesMode !== 'off') {
      ctx.save();
      const grad = ctx.createLinearGradient(0, h * 0.72, 0, h);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(1, 'rgba(5, 8, 15, 0.88)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, h * 0.72, w, h * 0.28);

      ctx.textAlign = 'center';
      const rawPrimaryLine =
        audioMode === 'english_original'
          ? activeSegment.englishText
          : subtitlesMode === 'hinglish'
          ? activeSegment.hinglishRoman
          : activeSegment.hindiDevanagari;
      const primaryLine = rawPrimaryLine.replace(/<(breath|sigh|laugh|gasp|sob|cry|angry|whisper)>/gi, '').trim();

      ctx.font = '600 16px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = '#F8FAFC';
      ctx.fillText(primaryLine, w / 2, h - 42, w - 48);

      if (subtitlesMode === 'bilingual' && audioMode === 'hindi_master') {
        ctx.font = '400 13px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = '#FCD34D';
        ctx.fillText(
          activeSegment.hinglishRoman.replace(/<(breath|sigh|laugh|gasp|sob|cry|angry|whisper)>/gi, '').trim(),
          w / 2,
          h - 20,
          w - 48
        );
      }
      ctx.restore();
    }
  }, [
    currentTime,
    durationSeconds,
    sourceType,
    selectedReel,
    uploadedVideoUrl,
    activeSegment,
    audioMode,
    subtitlesMode,
    lipSyncOverlayEnabled,
    mixConfig.lipSyncWarpIntensity,
    mouthOpen,
    mouthWidth,
    mouthAnchor,
    canvasRef,
    videoRef,
  ]);

  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (sourceType !== 'upload' || !lipSyncOverlayEnabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setMouthAnchor({ x: Math.max(0.15, Math.min(0.85, x)), y: Math.max(0.15, Math.min(0.85, y)) });
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onUploadVideoFile(file);
    }
  };

  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        if (!isDraggingOver) setIsDraggingOver(true);
      }}
      onDragLeave={() => {
        if (isDraggingOver) setIsDraggingOver(false);
      }}
      onDrop={handleDrop}
      className={`flex flex-col bg-white dark:bg-slate-900 border rounded-xl overflow-hidden transition-colors ${
        isDraggingOver
          ? 'border-amber-500 ring-2 ring-amber-500/30'
          : 'border-slate-200 dark:border-slate-800'
      }`}
    >
      {/* Top Studio Monitor Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3 min-w-0">
          <Film className="w-4 h-4 text-amber-500 shrink-0" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
            {sourceType === 'upload' && uploadedFileName
              ? uploadedFileName
              : selectedReel.title}
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline whitespace-nowrap">
            · {sourceType === 'upload' ? 'Your Uploaded Video' : selectedReel.category}
          </span>
        </div>

        {/* Before / After Live Audio Stream Switcher */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => onChangeAudioMode('english_original')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              audioMode === 'english_original'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Original Audio
          </button>
          <button
            type="button"
            onClick={() => onChangeAudioMode('hindi_master')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              audioMode === 'hindi_master'
                ? 'bg-amber-500 text-slate-950 font-semibold shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {hasHindiAudio ? 'Dubbed Hindi Master' : 'Hindi Dub Preview'}
          </button>
        </div>
      </div>

      {/* Hardware-Accelerated Video Monitor for Uploaded Files & Procedural Canvas for Sample Reels */}
      <div className="relative bg-slate-950 aspect-video w-full overflow-hidden flex items-center justify-center">
        {uploadedVideoUrl && (
          <video
            ref={videoRef}
            src={uploadedVideoUrl}
            className={`w-full h-full object-contain ${sourceType === 'upload' ? 'block' : 'hidden'}`}
            playsInline
            muted
            preload="auto"
            crossOrigin="anonymous"
          />
        )}

        <canvas
          ref={canvasRef}
          width={854}
          height={480}
          onClick={handleCanvasClick}
          className={`w-full h-full object-contain ${
            sourceType === 'sample'
              ? 'block'
              : lipSyncOverlayEnabled
              ? 'absolute inset-0 pointer-events-auto cursor-crosshair'
              : 'hidden'
          }`}
        />

        {/* Crisp Subtitle Overlay on Uploaded Video */}
        {sourceType === 'upload' && activeSegment && subtitlesMode !== 'off' && (
          <div className="absolute bottom-6 left-0 right-0 px-4 flex justify-center pointer-events-none z-10">
            <div className="max-w-[88%] px-4 py-2 bg-slate-950/85 backdrop-blur-xs border border-slate-800/80 rounded-lg shadow-2xl text-center">
              <div className="text-sm sm:text-base font-semibold text-slate-100 tracking-wide">
                {audioMode === 'english_original'
                  ? activeSegment.englishText
                  : subtitlesMode === 'hinglish'
                  ? activeSegment.hinglishRoman
                  : activeSegment.hindiDevanagari.replace(/<(breath|sigh|laugh|gasp|sob|cry|angry|whisper)>/gi, '').trim()}
              </div>
              {subtitlesMode === 'bilingual' && audioMode === 'hindi_master' && activeSegment.hinglishRoman && (
                <div className="text-xs text-amber-400 font-medium mt-0.5">
                  {activeSegment.hinglishRoman.replace(/<(breath|sigh|laugh|gasp|sob|cry|angry|whisper)>/gi, '').trim()}
                </div>
              )}
            </div>
          </div>
        )}

        {isDraggingOver && (
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-xs flex flex-col items-center justify-center gap-2 text-amber-400 pointer-events-none z-20">
            <Upload className="w-8 h-8 animate-bounce" />
            <span className="text-sm font-semibold">
              Drop Video Here to Auto-Dub into Realistic Indian Hindi
            </span>
          </div>
        )}

        {/* Subtle Top-Right Lip-Sync Telemetry Readout (Unboxed Typographic Metadata) */}
        <div className="absolute bottom-3 right-3 px-2.5 py-1 bg-slate-950/80 backdrop-blur-xs border border-slate-800 rounded text-[11px] font-mono tabular-nums text-slate-300 pointer-events-none">
          <span>Viseme: {activeViseme}</span>
          <span className="mx-1.5 text-slate-600">·</span>
          <span>
            Rate:{' '}
            {activeSegment
              ? `${activeSegment.playbackRate.toFixed(2)}x`
              : '1.00x'}
          </span>
        </div>
      </div>

      {/* Transport & Timeline Scrubber Bar */}
      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 space-y-3 bg-slate-50/60 dark:bg-slate-900/90">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause playback' : 'Play video'}
            className="w-9 h-9 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center justify-center transition-colors shrink-0"
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>

          <button
            type="button"
            onClick={() => onSeek(0)}
            aria-label="Restart from 00:00"
            className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center transition-colors shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <div className="text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300 shrink-0">
            {formatTimecode(currentTime)}{' '}
            <span className="text-slate-400 dark:text-slate-600">/</span>{' '}
            {formatTimecode(durationSeconds)}
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(1, durationSeconds)}
            step={0.05}
            value={Math.min(currentTime, durationSeconds)}
            onChange={(e) => onSeek( parseFloat(e.target.value) )}
            aria-label="Video timeline scrubber"
            className="w-full accent-amber-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
          />

          {/* Real-time Stereo Studio VU Meter */}
          <div
            className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-slate-900 border border-slate-800 rounded text-[10px] font-mono text-slate-400 shrink-0 select-none"
            title="Real-Time Stereo Master VU Level Meter"
          >
            <span className="text-[9px] font-bold text-amber-500">VU</span>
            <div className="w-10 h-2 bg-slate-950 rounded-xs overflow-hidden flex items-center p-0.5">
              <div
                className="h-full rounded-xs transition-all duration-75"
                style={{
                  width: isPlaying ? (activeSegment ? '84%' : '36%') : '6%',
                  background: isPlaying
                    ? activeSegment
                      ? 'linear-gradient(90deg, #10B981 60%, #F59E0B 85%, #EF4444 100%)'
                      : '#10B981'
                    : '#334155',
                }}
              />
            </div>
            <div className="w-10 h-2 bg-slate-950 rounded-xs overflow-hidden flex items-center p-0.5">
              <div
                className="h-full rounded-xs transition-all duration-75"
                style={{
                  width: isPlaying ? (activeSegment ? '80%' : '34%') : '6%',
                  background: isPlaying
                    ? activeSegment
                      ? 'linear-gradient(90deg, #10B981 60%, #F59E0B 85%, #EF4444 100%)'
                      : '#10B981'
                    : '#334155',
                }}
              />
            </div>
            <span className="tabular-nums text-[9px] text-slate-300">
              {isPlaying ? (activeSegment ? '-3.5 dB' : '-18 dB') : '-∞ dB'}
            </span>
          </div>
        </div>

        {/* Source Reel Switcher + Lip-Sync & Subtitle Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/70 dark:border-slate-800/80">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Select Studio Sample Reel"
              value={sourceType === 'sample' ? selectedReel.id : 'custom'}
              onChange={(e) => {
                const found = STUDIO_SAMPLE_REELS.find((r) => r.id === e.target.value);
                if (found) onSelectSampleReel(found);
              }}
              className="px-2.5 py-1.5 text-xs font-medium bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-500"
            >
              {STUDIO_SAMPLE_REELS.map((reel) => (
                <option key={reel.id} value={reel.id}>
                  Sample: {reel.title}
                </option>
              ))}
              {sourceType === 'upload' && (
                <option value="custom">Uploaded: {uploadedFileName}</option>
              )}
            </select>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUploadVideoFile(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload Your Video (Auto-Dub Hindi)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleLipSyncOverlay}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                lipSyncOverlayEnabled
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                  : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              Viseme Mesh
            </button>

            <div className="flex items-center gap-1 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1">
              <Subtitles className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                aria-label="Subtitle Burn-In Mode"
                value={subtitlesMode}
                onChange={(e) =>
                  onChangeSubtitlesMode(
                    e.target.value as 'hindi' | 'hinglish' | 'bilingual' | 'off'
                  )
                }
                className="text-xs bg-transparent text-slate-700 dark:text-slate-300 focus:outline-none"
              >
                <option value="bilingual">Subtitles: Hindi + Hinglish</option>
                <option value="hindi">Subtitles: Devanagari Only</option>
                <option value="hinglish">Subtitles: Hinglish Only</option>
                <option value="off">Subtitles: Off</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
