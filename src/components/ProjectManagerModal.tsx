import React, { useState, useEffect } from 'react';
import {
  FolderArchive,
  Save,
  Trash2,
  FolderOpen,
  Clock,
  Sparkles,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  LogIn,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  SavedDubbingProject,
  fetchUserProjects,
  saveProjectToFirestore,
  deleteProjectFromFirestore,
  fetchProjectSegments,
} from '../lib/firebase';
import { DubbingSegment, AdaptationStyle, IndianVocalDialect, GeminiVoiceId, GlobalSourceLanguage } from '../types/dubbing';

interface ProjectManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentProjectData: {
    title: string;
    sourceLanguage: GlobalSourceLanguage;
    adaptationStyle: AdaptationStyle;
    indianDialect: IndianVocalDialect;
    globalVoiceId: GeminiVoiceId;
    durationSeconds: number;
    uploadedFileName: string | null;
    segments: DubbingSegment[];
  };
  onLoadProject: (
    project: SavedDubbingProject,
    loadedSegments: DubbingSegment[]
  ) => void;
}

export function ProjectManagerModal({
  isOpen,
  onClose,
  currentProjectData,
  onLoadProject,
}: ProjectManagerModalProps) {
  const { user, signIn, isDbConnected } = useAuth();
  const [projects, setProjects] = useState<SavedDubbingProject[]>([]);
  const [isLoadingList, setIsLoadingList] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [projectTitleInput, setProjectTitleInput] = useState<string>(
    currentProjectData.title || 'Untitled Hindi Dubbing Project'
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && currentProjectData.title) {
      setProjectTitleInput(currentProjectData.title);
    }
  }, [isOpen, currentProjectData.title]);

  const loadList = async () => {
    if (!user) return;
    setIsLoadingList(true);
    setErrorMessage(null);
    try {
      const list = await fetchUserProjects(user.uid);
      setProjects(list);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load projects from Firestore.');
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    if (isOpen && user) {
      loadList();
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  const handleSaveCurrent = async () => {
    if (!user) {
      setErrorMessage('Please sign in with Google to save projects.');
      return;
    }
    const cleanTitle = projectTitleInput.trim() || 'Untitled Hindi Dubbing Project';
    setIsSaving(true);
    setErrorMessage(null);
    setStatusMessage(null);

    const projectId = `proj-${Date.now()}`;
    const now = new Date().toISOString();

    const projDoc: SavedDubbingProject = {
      id: projectId,
      ownerId: user.uid,
      title: cleanTitle,
      sourceLanguage: currentProjectData.sourceLanguage,
      adaptationStyle: currentProjectData.adaptationStyle,
      indianDialect: currentProjectData.indianDialect,
      globalVoiceId: currentProjectData.globalVoiceId,
      durationSeconds: currentProjectData.durationSeconds,
      uploadedFileName: currentProjectData.uploadedFileName || 'Sample Reel',
      status: 'in_progress',
      segmentCount: currentProjectData.segments.length,
      createdAt: now,
      updatedAt: now,
    };

    const segmentDocs = currentProjectData.segments.map((s, idx) => ({
      id: `seg-${idx + 1}`,
      projectId,
      ownerId: user.uid,
      index: s.index,
      startTime: s.startTime,
      endTime: s.endTime,
      speaker: s.speaker || 'Speaker 1',
      detectedLanguage: s.detectedLanguage || 'Detected Speech',
      englishText: s.englishText || '',
      hindiDevanagari: s.hindiDevanagari || '',
      hinglishRoman: s.hinglishRoman || '',
      emotionPrompt: s.emotionPrompt || '',
      indianDialect: s.indianDialect || currentProjectData.indianDialect,
      voiceId: s.voiceId || currentProjectData.globalVoiceId,
      playbackRate: s.playbackRate || 1.0,
      hasAudio: Boolean(s.generatedWavBase64),
      createdAt: now,
      updatedAt: now,
    }));

    try {
      await saveProjectToFirestore(projDoc, segmentDocs);
      setStatusMessage('Project saved successfully to Firestore!');
      await loadList();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to save project.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoad = async (p: SavedDubbingProject) => {
    setLoadingProjectId(p.id);
    setErrorMessage(null);
    try {
      const segDocs = await fetchProjectSegments(p.id);
      const loaded: DubbingSegment[] = segDocs.map((doc, idx) => ({
        id: `seg-${doc.index + 1}-${Date.now()}`,
        index: doc.index ?? idx,
        startTime: doc.startTime ?? 0,
        endTime: doc.endTime ?? 1,
        speaker: doc.speaker || 'Speaker 1',
        detectedLanguage: doc.detectedLanguage,
        englishText: doc.englishText || '',
        hindiDevanagari: doc.hindiDevanagari || '',
        hinglishRoman: doc.hinglishRoman || '',
        emotionPrompt: doc.emotionPrompt || '',
        indianDialect: (doc.indianDialect as IndianVocalDialect) || 'mumbai_cinema',
        humanBreathEnabled: true,
        voiceId: (doc.voiceId as GeminiVoiceId) || 'Charon',
        englishSyllables: 12,
        hindiSyllables: 15,
        playbackRate: doc.playbackRate || 1.0,
      }));
      onLoadProject(p, loaded);
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load project details.');
    } finally {
      setLoadingProjectId(null);
    }
  };

  const handleDelete = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this project?')) return;
    try {
      await deleteProjectFromFirestore(projectId);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to delete project.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 dark:bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <FolderArchive className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Firestore Dubbing Projects
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Persist & sync your video dubbing projects across sessions
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

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Auth State Warning if Not Signed In */}
          {!user ? (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                <div className="text-xs text-amber-900 dark:text-amber-200">
                  <span className="font-semibold">Sign in required:</span> Connect your
                  Google account to save your dubbing projects and access them anytime.
                </div>
              </div>
              <button
                type="button"
                onClick={signIn}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg shrink-0 transition-colors shadow-xs"
              >
                <LogIn className="w-3.5 h-3.5" />
                Sign in with Google
              </button>
            </div>
          ) : (
            /* Save Active Project Section */
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Save className="w-3.5 h-3.5 text-amber-500" />
                  Save Active Session to Firestore
                </span>
                <span className="text-[11px] text-slate-500 font-mono">
                  {currentProjectData.segments.length} segments ·{' '}
                  {currentProjectData.durationSeconds.toFixed(1)}s
                </span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  value={projectTitleInput}
                  onChange={(e) => setProjectTitleInput(e.target.value)}
                  placeholder="Enter project name..."
                  className="flex-1 px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-amber-500"
                />
                <button
                  type="button"
                  onClick={handleSaveCurrent}
                  disabled={isSaving}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg disabled:opacity-50 transition-colors shrink-0"
                >
                  {isSaving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  {isSaving ? 'Saving...' : 'Save Project'}
                </button>
              </div>
            </div>
          )}

          {/* Feedback Banners */}
          {statusMessage && (
            <div className="p-3 text-xs rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}
          {errorMessage && (
            <div className="p-3 text-xs rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Saved Projects List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Your Saved Projects {projects.length > 0 && `(${projects.length})`}
              </h3>
              {user && (
                <button
                  type="button"
                  onClick={loadList}
                  disabled={isLoadingList}
                  className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline"
                >
                  {isLoadingList ? 'Refreshing...' : 'Refresh'}
                </button>
              )}
            </div>

            {isLoadingList ? (
              <div className="py-8 flex flex-col items-center justify-center text-slate-400 gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
                <span className="text-xs">Fetching your Firestore projects...</span>
              </div>
            ) : projects.length === 0 ? (
              <div className="py-8 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                <FolderOpen className="w-8 h-8 mx-auto text-slate-400/60 mb-2" />
                <p className="text-xs">
                  {user
                    ? 'No saved projects found. Save your current dubbing project above!'
                    : 'Sign in to see your saved dubbing projects.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {projects.map((proj) => {
                  const isLoadingThis = loadingProjectId === proj.id;
                  return (
                    <div
                      key={proj.id}
                      onClick={() => handleLoad(proj)}
                      className="group p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-amber-500/50 bg-slate-50/50 dark:bg-slate-950/40 hover:bg-amber-500/[0.04] transition-all cursor-pointer flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {proj.title}
                          </span>
                          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded-sm bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {proj.sourceLanguage || 'auto'} → HI
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(proj.updatedAt).toLocaleDateString()}
                          </span>
                          <span>•</span>
                          <span>{proj.segmentCount} Cues</span>
                          <span>•</span>
                          <span>{proj.durationSeconds?.toFixed(1)}s</span>
                          <span>•</span>
                          <span className="capitalize">{proj.globalVoiceId}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLoad(proj);
                          }}
                          disabled={isLoadingThis}
                          className="px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 rounded-md transition-colors flex items-center gap-1"
                        >
                          {isLoadingThis ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Sparkles className="w-3 h-3" />
                          )}
                          Load
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDelete(proj.id, e)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
                          title="Delete Project"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 flex items-center justify-between text-[11px] text-slate-500">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                isDbConnected ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
              }`}
            />
            <span>Firestore: {isDbConnected ? 'Connected' : 'Connecting...'}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
