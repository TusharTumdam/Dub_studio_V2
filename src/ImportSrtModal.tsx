import React, { useState } from 'react';
import {
  FileText,
  Upload,
  X,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Play,
  Film,
} from 'lucide-react';
import { DubbingSegment, GeminiVoiceId, IndianVocalDialect } from '../types/dubbing';
import { parseSrtToDubbingSegments, readSubtitleFileAsText } from '../utils/audioEngine';

interface ImportSrtModalProps {
  isOpen: boolean;
  onClose: () => void;
  globalVoiceId: GeminiVoiceId;
  indianDialect: IndianVocalDialect;
  onImportSegments: (segments: DubbingSegment[], fileName: string, autoRunDub: boolean) => void;
}

const SAMPLE_ACTION_MOVIE_SRT = `1
00:00:01,200 --> 00:00:04,800
[CAPTAIN MILLER]: Perimeter breached! All squads fall back to Sector Four immediately!

2
00:00:05,200 --> 00:00:08,900
[PILOT RAY]: I've lost main hydraulic pressure! We have thirty seconds before engine flameout!

3
00:00:09,400 --> 00:00:13,500
[SPECIALIST MAYA]: Override the fuel valve manually! I am transferring auxiliary power right now!

4
00:00:14,000 --> 00:00:18,200
[CAPTAIN MILLER]: Hold the line! We are not leaving anyone behind today!`;

export function ImportSrtModal({
  isOpen,
  onClose,
  globalVoiceId,
  indianDialect,
  onImportSegments,
}: ImportSrtModalProps) {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [srtText, setSrtText] = useState<string>('');
  const [uploadedFileName, setUploadedFileName] = useState<string>('movie_subtitles.srt');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewSegs, setPreviewSegs] = useState<DubbingSegment[]>([]);

  if (!isOpen) return null;

  const handleProcessText = (raw: string, fileName = 'movie_subtitles.srt') => {
    setSrtText(raw);
    setUploadedFileName(fileName);
    setErrorMessage(null);
    try {
      const parsed = parseSrtToDubbingSegments(raw, globalVoiceId, indianDialect);
      if (parsed.length === 0) {
        setErrorMessage(
          'Could not find standard subtitle timestamps (e.g. 00:00:01,000 --> 00:00:04,000). Check format or paste sample.'
        );
        setPreviewSegs([]);
      } else {
        setPreviewSegs(parsed);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to parse subtitle text.');
      setPreviewSegs([]);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Guard: If user accidentally picked a video or audio file instead of subtitles
    if (
      file.type.startsWith('video/') ||
      file.type.startsWith('audio/') ||
      /\.(mp4|mkv|webm|avi|mov|mp3|wav|m4a|flac)$/i.test(file.name)
    ) {
      setErrorMessage(
        `"${file.name}" is a video/audio file. To dub this video, please click the orange "Upload Video to Dub in Hindi" button in the studio toolbar.`
      );
      return;
    }

    try {
      const text = await readSubtitleFileAsText(file);
      handleProcessText(text, file.name);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to read file from your device.');
    }
    e.target.value = '';
  };


  const handleLoadSample = () => {
    handleProcessText(SAMPLE_ACTION_MOVIE_SRT, 'Action_Movie_Scene.srt');
    setActiveTab('paste');
  };

  const handleConfirmImport = (autoRunDub: boolean) => {
    if (previewSegs.length === 0) {
      setErrorMessage('Please select a valid .SRT file or paste subtitle cues first.');
      return;
    }
    onImportSegments(previewSegs, uploadedFileName, autoRunDub);
    onClose();
  };

  const uniqueSpeakers = Array.from(new Set(previewSegs.map((s) => s.speaker)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 dark:bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <Film className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Import Movie .SRT / .VTT Subtitles
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Import timecoded movie dialogues for multi-character Indian Hindi dubbing
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 px-5 bg-slate-50/50 dark:bg-slate-950/30">
          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={`py-2.5 px-4 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'upload'
                ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            Upload .SRT / .VTT File
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('paste')}
            className={`py-2.5 px-4 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'paste'
                ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            Paste Subtitle Text
          </button>
          <button
            type="button"
            onClick={handleLoadSample}
            className="py-2.5 px-4 text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline ml-auto flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3" />
            Load Sample Movie SRT
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {activeTab === 'upload' ? (
            <div className="space-y-3">
              <label
                htmlFor="srt-file-picker-modal"
                className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-amber-500 dark:hover:border-amber-500/80 rounded-xl bg-slate-50/50 dark:bg-slate-950/40 cursor-pointer transition-colors group"
              >
                <input
                  id="srt-file-picker-modal"
                  type="file"
                  accept=".srt,.vtt,.txt,text/plain,text/vtt,*/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="w-12 h-12 rounded-full bg-amber-500/10 group-hover:bg-amber-500/20 flex items-center justify-center text-amber-500 mb-2 transition-colors">
                  <Upload className="w-6 h-6" />
                </div>
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Tap to Select .SRT / .VTT File
                </span>
                <span className="text-xs text-slate-500 mt-1">
                  Supports standard movie subtitles (.srt, .vtt, .txt)
                </span>
              </label>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center justify-between">
                <span>Paste SRT or WebVTT timestamped cues:</span>
                <span className="text-[11px] text-slate-400">e.g. 00:00:01,000 --&gt; 00:00:04,000</span>
              </label>
              <textarea
                rows={7}
                value={srtText}
                onChange={(e) => handleProcessText(e.target.value, uploadedFileName)}
                placeholder={`1\n00:00:01,000 --> 00:00:04,000\n[HERO]: The city is finally safe.\n\n2\n00:00:04,500 --> 00:00:08,000\n[VILLAIN]: Not for long.`}
                className="w-full p-3 font-mono text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-500 focus:outline-hidden focus:border-amber-500"
              />
            </div>
          )}

          {/* Feedback & Error */}
          {errorMessage && (
            <div className="p-3 text-xs rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Parsed Cues Preview */}
          {previewSegs.length > 0 && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  Successfully Parsed {previewSegs.length} Dialogue Cues
                </span>
                <span className="font-mono text-[11px]">
                  Duration: {previewSegs[previewSegs.length - 1].endTime.toFixed(1)}s
                </span>
              </div>
              <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                <span>Characters detected: </span>
                <span className="font-semibold">
                  {uniqueSpeakers.join(', ')} ({uniqueSpeakers.length} unique character voices)
                </span>
              </div>
              <div className="max-h-28 overflow-y-auto pr-1 space-y-1.5 text-[11px] text-slate-700 dark:text-slate-300 font-mono">
                {previewSegs.slice(0, 4).map((s, idx) => (
                  <div key={idx} className="truncate">
                    <span className="text-amber-600 dark:text-amber-400">[{s.startTime}s - {s.endTime}s]</span>{' '}
                    <span className="font-semibold">{s.speaker}:</span> {s.englishText}
                  </div>
                ))}
                {previewSegs.length > 4 && (
                  <div className="text-slate-500 italic">
                    ...and {previewSegs.length - 4} more movie dialogue cues
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 flex flex-wrap items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleConfirmImport(false)}
              disabled={previewSegs.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 disabled:opacity-50 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              Import to Script Studio
            </button>

            <button
              type="button"
              onClick={() => handleConfirmImport(true)}
              disabled={previewSegs.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg disabled:opacity-50 transition-colors shadow-xs"
            >
              <Play className="w-3.5 h-3.5" />
              Import & Auto-Dub Hindi
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
