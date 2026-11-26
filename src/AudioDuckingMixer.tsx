import React, { useEffect, useRef, useState } from 'react';
import { Sliders, Volume2, Download, ShieldCheck, Wand2, Sparkles, Loader2 } from 'lucide-react';
import { AudioMixConfig, DubbingSegment, SfxFoleyPreset } from '../types/dubbing';
import { computeDuckingEnvelopeCurve, formatTimecode } from '../utils/audioEngine';

interface AudioDuckingMixerProps {
  waveformPeaks: number[];
  durationSeconds: number;
  currentTime: number;
  segments: DubbingSegment[];
  mixConfig: AudioMixConfig;
  isRenderingMix: boolean;
  onUpdateMixConfig: (patch: Partial<AudioMixConfig>) => void;
  onSeek: (time: number) => void;
  onDownloadMasterWav: () => void;
  onDownloadExtractedWav: () => void;
}

export const AudioDuckingMixer: React.FC<AudioDuckingMixerProps> = ({
  waveformPeaks,
  durationSeconds,
  currentTime,
  segments,
  mixConfig,
  isRenderingMix,
  onUpdateMixConfig,
  onSeek,
  onDownloadMasterWav,
  onDownloadExtractedWav,
}) => {
  const timelineCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sfxPromptInput, setSfxPromptInput] = useState<string>(
    mixConfig.customSfxPrompt || 'creator studio subtle foley and transition whoosh'
  );
  const [isGeneratingSfx, setIsGeneratingSfx] = useState<boolean>(false);
  const [sfxStatusBadge, setSfxStatusBadge] = useState<string | null>(null);

  const handleGenerateMcpSfx = async () => {
    if (!sfxPromptInput.trim()) return;
    setIsGeneratingSfx(true);
    setSfxStatusBadge(null);
    try {
      const res = await fetch('/api/dubbing/sfx-mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: sfxPromptInput.trim(),
          durationSeconds: Math.min(12, Math.max(4, durationSeconds)),
        }),
      });
      const data = await res.json();
      if (res.ok && data.audioBase64) {
        onUpdateMixConfig({
          sfxAmbienceEnabled: true,
          sfxPreset: 'custom_mcp',
          customSfxPrompt: sfxPromptInput.trim(),
          customSfxAudioBase64: data.audioBase64,
        });
        setSfxStatusBadge(`Generated & mixed via ${data.provider}`);
      } else {
        setSfxStatusBadge('SFX synthesis fallback active');
      }
    } catch {
      setSfxStatusBadge('SFX Engine MCP fallback active');
    } finally {
      setIsGeneratingSfx(false);
    }
  };

  useEffect(() => {
    const canvas = timelineCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Background tracks divider
    const track1H = h * 0.52;
    ctx.fillStyle = '#090D16';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, track1H);
    ctx.lineTo(w, track1H);
    ctx.stroke();

    // Track 1: Original Audio Waveform + Sidechain Ducking Envelope Curve
    const bucketCount = waveformPeaks.length || 180;
    const barW = Math.max(2, w / bucketCount - 1.5);
    const duckCurve = computeDuckingEnvelopeCurve(
      Math.max(1, durationSeconds),
      segments,
      mixConfig,
      bucketCount
    );

    for (let i = 0; i < bucketCount; i++) {
      const peak = waveformPeaks[i] ?? 0.15;
      const x = (i / bucketCount) * w;
      const attenuatedPeak = peak * duckCurve[i];
      const barH = Math.max(3, attenuatedPeak * (track1H - 18));
      const y = (track1H - barH) / 2;

      ctx.fillStyle = duckCurve[i] < 0.65 ? '#334155' : '#64748B';
      ctx.fillRect(x, y, barW, barH);
    }

    // Draw Amber Sidechain Ducking Gain Envelope Line over Track 1
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < bucketCount; i++) {
      const x = (i / bucketCount) * w;
      const y = track1H - duckCurve[i] * (track1H - 14) - 6;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Track 2: Time-Aligned Hindi Neural TTS Segments
    const track2Y = track1H + 8;
    const track2H = h - track1H - 16;

    for (const seg of segments) {
      const xStart = (seg.startTime / Math.max(1, durationSeconds)) * w;
      const xEnd = (seg.endTime / Math.max(1, durationSeconds)) * w;
      const segW = Math.max(12, xEnd - xStart);

      ctx.fillStyle = seg.generatedWavBase64
        ? 'rgba(16, 185, 129, 0.22)'
        : 'rgba(245, 158, 11, 0.16)';
      ctx.strokeStyle = seg.generatedWavBase64 ? '#10B981' : '#F59E0B';
      ctx.lineWidth = 1.25;

      ctx.beginPath();
      ctx.roundRect(xStart, track2Y, segW, track2H, 5);
      ctx.fill();
      ctx.stroke();

      // Simulated Hindi voice waveform inside segment block
      if (seg.generatedWavBase64) {
        ctx.fillStyle = '#10B981';
        const innerBars = Math.max(4, Math.floor(segW / 5));
        for (let b = 0; b < innerBars; b++) {
          const bx = xStart + 4 + b * 4.5;
          if (bx > xEnd - 4) break;
          const bh =
            (0.3 + 0.65 * Math.abs(Math.sin(b * 1.4 + seg.index))) * (track2H - 18);
          ctx.fillRect(bx, track2Y + (track2H - bh) / 2, 2.5, bh);
        }
      }

      // Segment label inside block
      ctx.fillStyle = '#F8FAFC';
      ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(
        `#${seg.index + 1} ${seg.voiceId} (${seg.playbackRate.toFixed(2)}x)`,
        xStart + 6,
        track2Y + 13,
        Math.max(0, segW - 10)
      );
    }

    // Track Labels
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(8, 6, 310, 18);
    ctx.fillRect(8, track1H + 6, 310, 18);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.fillText(
      `TRK 1 · BGM + SFX ENGINE FOLEY + DUCK (${mixConfig.duckingReductionDb} dB)`,
      12,
      18
    );
    ctx.fillStyle = '#10B981';
    ctx.fillText('TRK 2 · TIME-ALIGNED HINDI NEURAL VOICE (.WAV)', 12, track1H + 18);

    // Playhead Vertical Cursor
    const playheadX = (currentTime / Math.max(1, durationSeconds)) * w;
    ctx.strokeStyle = '#F43F5E';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, h);
    ctx.stroke();
  }, [waveformPeaks, durationSeconds, currentTime, segments, mixConfig]);

  const handleCanvasTimelineClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * durationSeconds);
  };

  return (
    <section className="flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <Sliders className="w-4 h-4 text-amber-500 shrink-0" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Multi-Track Timeline, SFX Engine Foley & Sidechain Audio Ducking Mixer
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Suppresses original English speech while mixing SFX Engine foley & studio warmth EQ under Hindi dialogue
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onDownloadExtractedWav}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Source Audio (.wav)
          </button>

          <button
            type="button"
            onClick={onDownloadMasterWav}
            disabled={isRenderingMix}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            {isRenderingMix ? 'Mixing Master...' : 'Export Mixed Hindi Stem (.wav)'}
          </button>
        </div>
      </div>

      {/* Interactive Dual-Track Waveform & Sidechain Ducking Canvas */}
      <div className="p-4 bg-slate-950 border-b border-slate-800">
        <canvas
          ref={timelineCanvasRef}
          width={1100}
          height={150}
          onClick={handleCanvasTimelineClick}
          className="w-full h-[140px] rounded-lg border border-slate-800 cursor-pointer"
        />
        <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400 mt-2">
          <span>00:00.0</span>
          <span>Click anywhere on the multi-track timeline to scrub playhead</span>
          <span>{formatTimecode(durationSeconds)}</span>
        </div>
      </div>

      {/* DSP Faders & Lip-Sync Calibration Controls */}
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-slate-50/50 dark:bg-slate-900">
        {/* Control 1: Hindi Lead Vocal Gain */}
        <div className="p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Hindi Vocal Gain
            </span>
            <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400 font-semibold">
              {mixConfig.hindiVocalGainDb > 0 ? `+${mixConfig.hindiVocalGainDb}` : mixConfig.hindiVocalGainDb} dB
            </span>
          </div>
          <input
            type="range"
            min={-12}
            max={6}
            step={0.5}
            value={mixConfig.hindiVocalGainDb}
            onChange={(e) =>
              onUpdateMixConfig({ hindiVocalGainDb: parseFloat(e.target.value) })
            }
            className="w-full accent-amber-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded cursor-pointer"
          />
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Master bus level for synthesized 24kHz Hindi dialogue
          </p>
        </div>

        {/* Control 2: Sidechain Auto-Ducking Depth */}
        <div className="p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Speech Ducking Attenuation
            </span>
            <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400 font-semibold">
              {mixConfig.duckingReductionDb} dB
            </span>
          </div>
          <input
            type="range"
            min={-28}
            max={0}
            step={1}
            value={mixConfig.duckingReductionDb}
            onChange={(e) =>
              onUpdateMixConfig({ duckingReductionDb: parseFloat(e.target.value) })
            }
            className="w-full accent-amber-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded cursor-pointer"
          />
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Ducks original track when Hindi dialogue is active
          </p>
        </div>

        {/* Control 3: Background Bed & Attack/Release */}
        <div className="p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Original Ambience / BGM Bed
            </span>
            <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400 font-semibold">
              {mixConfig.bgmBaseGainDb > 0 ? `+${mixConfig.bgmBaseGainDb}` : mixConfig.bgmBaseGainDb} dB
            </span>
          </div>
          <input
            type="range"
            min={-24}
            max={3}
            step={0.5}
            value={mixConfig.bgmBaseGainDb}
            onChange={(e) =>
              onUpdateMixConfig({ bgmBaseGainDb: parseFloat(e.target.value) })
            }
            className="w-full accent-amber-500 h-1.5 bg-slate-200 dark:bg-slate-800 rounded cursor-pointer"
          />
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Attack {mixConfig.duckingAttackMs}ms · Release {mixConfig.duckingReleaseMs}ms
          </p>
        </div>

        {/* Control 4: Vocal Isolation EQ & Lip-Sync Time Warp */}
        <div className="p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col justify-between gap-2">
          <label className="flex items-center justify-between gap-2 cursor-pointer">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              Center Vocal Cut Filter
            </span>
            <input
              type="checkbox"
              checked={mixConfig.vocalIsolationEnabled}
              onChange={(e) =>
                onUpdateMixConfig({ vocalIsolationEnabled: e.target.checked })
              }
              className="accent-amber-500 w-4 h-4 rounded"
            />
          </label>

          <label className="flex items-center justify-between gap-2 cursor-pointer">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              Indian Studio Vocal Warmth EQ
            </span>
            <input
              type="checkbox"
              checked={mixConfig.studioWarmthEqEnabled}
              onChange={(e) =>
                onUpdateMixConfig({ studioWarmthEqEnabled: e.target.checked })
              }
              className="accent-amber-500 w-4 h-4 rounded"
            />
          </label>

          <label className="flex items-center justify-between gap-2 cursor-pointer">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Wand2 className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              Auto Lip-Sync Time Stretch
            </span>
            <input
              type="checkbox"
              checked={mixConfig.autoTimeStretchLipSync}
              onChange={(e) =>
                onUpdateMixConfig({ autoTimeStretchLipSync: e.target.checked })
              }
              className="accent-amber-500 w-4 h-4 rounded"
            />
          </label>

          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200 dark:border-slate-800">
            <span>Mouth Viseme Warp</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={mixConfig.lipSyncWarpIntensity}
              onChange={(e) =>
                onUpdateMixConfig({ lipSyncWarpIntensity: parseInt(e.target.value, 10) })
              }
              className="w-24 accent-amber-500 h-1"
            />
            <span className="font-mono tabular-nums">{mixConfig.lipSyncWarpIntensity}%</span>
          </div>
        </div>
      </div>

      {/* SFX Engine MCP (https://api.sfxengine.com/mcp) & Studio Foley Layer Bar */}
      <div className="px-4 py-3 bg-slate-100/70 dark:bg-slate-950/80 border-t border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={mixConfig.sfxAmbienceEnabled !== false}
              onChange={(e) =>
                onUpdateMixConfig({ sfxAmbienceEnabled: e.target.checked })
              }
              className="accent-amber-500 w-4 h-4 rounded"
            />
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              SFX Engine MCP Foley Layer (<code className="font-mono text-[11px]">api.sfxengine.com/mcp</code>)
            </span>
          </label>

          <select
            value={mixConfig.sfxPreset || 'creator_studio'}
            onChange={(e) =>
              onUpdateMixConfig({
                sfxAmbienceEnabled: e.target.value !== 'none',
                sfxPreset: e.target.value as SfxFoleyPreset,
              })
            }
            className="px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200"
          >
            <option value="creator_studio">Creator Studio Foley + Transition Whoosh</option>
            <option value="cinematic_riser">Cinematic Sub-Bass & Whoosh Riser</option>
            <option value="warm_room_tone">Warm Dubbing Booth Room Tone</option>
            <option value="rain_foley">Monsoon Rain & Atmospheric Foley</option>
            <option value="custom_mcp">Custom SFX Prompt (MCP Generator)</option>
            <option value="none">Off (Dry Voiceover Only)</option>
          </select>

          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span>SFX Level</span>
            <input
              type="range"
              min={-24}
              max={0}
              step={1}
              value={mixConfig.sfxGainDb ?? -10}
              onChange={(e) =>
                onUpdateMixConfig({ sfxGainDb: parseFloat(e.target.value) })
              }
              className="w-20 accent-amber-500 h-1.5"
            />
            <span className="font-mono tabular-nums">{mixConfig.sfxGainDb ?? -10} dB</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={sfxPromptInput}
            onChange={(e) => setSfxPromptInput(e.target.value)}
            placeholder="Describe SFX (e.g. subtle keyboard clicks & whoosh)..."
            className="w-full sm:w-64 px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200"
          />
          <button
            type="button"
            onClick={handleGenerateMcpSfx}
            disabled={isGeneratingSfx}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            {isGeneratingSfx ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            Generate SFX
          </button>
          {sfxStatusBadge && (
            <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
              {sfxStatusBadge}
            </span>
          )}
        </div>
      </div>
    </section>
  );
};
