import React, { useEffect, useState } from 'react';
import { X, Cpu, CheckCircle2, Globe, RefreshCw } from 'lucide-react';
import { ExternalProviderConfig } from '../types/dubbing';

interface ProviderModalProps {
  isOpen: boolean;
  config: ExternalProviderConfig;
  onClose: () => void;
  onUpdateConfig: (patch: Partial<ExternalProviderConfig>) => void;
}

interface ElevenLabsModelItem {
  model_id: string;
  name: string;
  supportsHindi?: boolean;
}

interface ElevenLabsVoiceItem {
  voice_id: string;
  name: string;
}

export const ProviderModal: React.FC<ProviderModalProps> = ({
  isOpen,
  config,
  onClose,
  onUpdateConfig,
}) => {
  const [models, setModels] = useState<ElevenLabsModelItem[]>([
    {
      model_id: 'eleven_multilingual_v2',
      name: 'Eleven Multilingual v2 (Hindi & Hinglish Studio)',
      supportsHindi: true,
    },
    {
      model_id: 'eleven_flash_v2_5',
      name: 'Eleven Flash v2.5 (Ultra-Low Latency Hindi)',
      supportsHindi: true,
    },
    {
      model_id: 'eleven_turbo_v2_5',
      name: 'Eleven Turbo v2.5 (Balanced Hindi Dubbing)',
      supportsHindi: true,
    },
  ]);
  const [voices, setVoices] = useState<ElevenLabsVoiceItem[]>([
    { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'Charon / George (Warm Narrative Baritone)' },
    { voice_id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Puck / Liam (Energetic Indian Creator)' },
    { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Kore / Sarah (Expressive Female)' },
    { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Fenrir / Adam (Deep Trailer Voice)' },
  ]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [envConfigured, setEnvConfigured] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const fetchElevenLabsCatalog = async () => {
    setIsLoadingModels(true);
    setStatusNote(null);
    try {
      const res = await fetch('/api/elevenlabs/models');
      const data = await res.json();
      if (Array.isArray(data.models) && data.models.length > 0) {
        setModels(data.models);
      }
      if (Array.isArray(data.voices) && data.voices.length > 0) {
        setVoices(data.voices);
      }
      setEnvConfigured(Boolean(data.configured));
      if (data.error) {
        setStatusNote(data.error);
      } else if (data.configured) {
        setStatusNote(
          `Loaded ${data.models?.length || 0} TTS models from https://api.elevenlabs.io/v1/models via ELEVENLABS_API_KEY.`
        );
      } else {
        setStatusNote(
          'Set ELEVENLABS_API_KEY in AI Studio Secrets to query live https://api.elevenlabs.io/v1/models.'
        );
      }
    } catch {
      setStatusNote('Could not reach /api/elevenlabs/models.');
    } finally {
      setIsLoadingModels(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchElevenLabsCatalog();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-4">
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-4 h-4 text-amber-500" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              AI Pipeline & Voice Models Configuration
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Built-in Zero-Setup Pipeline Card */}
          <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                Built-In Server-Side AI Engine (Active Out-of-the-Box)
              </span>
              <span className="text-xs font-mono text-slate-500">24kHz · 16-bit WAV</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Stages 2, 3, and 4 run automatically via server-side Gemini models (
              <code className="font-mono text-amber-600 dark:text-amber-400">gemini-3.1-flash-lite</code>,{' '}
              <code className="font-mono text-amber-600 dark:text-amber-400">gemini-3.5-transcribe</code>, and{' '}
              <code className="font-mono text-amber-600 dark:text-amber-400">
                {config.useHighExpressiveGeminiTts ? 'gemini-3.8-flash-tts' : 'gemini-3.8-flash-lite-tts'}
              </code>
              ) with zero external setup required.
            </p>
            <label className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800 cursor-pointer">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Use Flagship Screenplay Voice Design Model (gemini-3.8-flash-tts)
              </span>
              <input
                type="checkbox"
                checked={config.useHighExpressiveGeminiTts}
                onChange={(e) =>
                  onUpdateConfig({ useHighExpressiveGeminiTts: e.target.checked })
                }
                className="accent-amber-500 w-4 h-4"
              />
            </label>
          </div>

          {/* Optional External Provider 1: ElevenLabs /v1/models & Multilingual v2 */}
          <div className="p-4 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.elevenLabsEnabled}
                  onChange={(e) =>
                    onUpdateConfig({ elevenLabsEnabled: e.target.checked })
                  }
                  className="accent-amber-500 w-4 h-4"
                />
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-amber-500" />
                    ElevenLabs Hindi TTS Bridge (/v1/models & /v1/text-to-speech)
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Uses server-side <code className="font-mono">ELEVENLABS_API_KEY</code> secret ({envConfigured ? 'Detected' : 'Not set in Secrets'})
                  </p>
                </div>
              </label>
              <button
                type="button"
                onClick={fetchElevenLabsCatalog}
                disabled={isLoadingModels}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
                Sync /v1/models
              </button>
            </div>

            {statusNote && (
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800">
                {statusNote}
              </p>
            )}

            {config.elevenLabsEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">
                    ElevenLabs Model (/v1/models)
                  </label>
                  <select
                    value={config.elevenLabsModelId || 'eleven_multilingual_v2'}
                    onChange={(e) =>
                      onUpdateConfig({ elevenLabsModelId: e.target.value })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200"
                  >
                    {models.map((m) => (
                      <option key={m.model_id} value={m.model_id}>
                        {m.name} ({m.model_id})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">
                    ElevenLabs Voice (/v1/voices)
                  </label>
                  <select
                    value={config.elevenLabsVoiceId || 'JBFqnCBsd6RMkjVDRZzb'}
                    onChange={(e) =>
                      onUpdateConfig({ elevenLabsVoiceId: e.target.value })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200"
                  >
                    {voices.map((v) => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors"
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
};
