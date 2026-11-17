import { create } from 'zustand';
import { DEFAULT_EDIT_STATE } from './types';
import type { EditState, Step, ClipSegment, VideoMeta, YouTubeInfo, FontAsset, SfxAsset } from './types';

// Ekstrak 11-karakter YouTube video ID dari berbagai format URL
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/)([A-Za-z0-9_-]{11})/,
    /youtube\.com\/v\/([A-Za-z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = (url || '').match(p);
    if (m) return m[1];
  }
  return null;
}

interface SupaisuStore {
  // wizard step
  step: Step;
  setStep: (s: Step) => void;

  // source state
  youtubeUrl: string;
  youtubeVideoId: string;    // extracted 11-char ID, never null
  setYoutubeUrl: (u: string) => void;
  setYoutubeVideoId: (id: string | null) => void;
  /** Simpan URL + ekstrak ID secara atomik — pakai ini dari SourceStep */
  setYoutubeSource: (url: string) => void;
  youtubeInfo: YouTubeInfo | null;
  setYoutubeInfo: (info: YouTubeInfo | null) => void;
  ytJobId: string | null;
  setYtJobId: (id: string | null) => void;
  videoMeta: VideoMeta | null;
  setVideoMeta: (m: VideoMeta | null) => void;
  videoUrl: string | null;        // for browser playback
  previewUrl: string | null;      // proxy if needs_proxy
  setVideoUrl: (url: string | null, preview?: string | null) => void;
  srtSource: string;              // 'youtube-manual' | 'youtube-auto' | 'upload' | 'none'
  setSrtSource: (s: string) => void;

  // download progress for deferred download
  isDownloadingYoutube: boolean;
  youtubeDownloadProgress: number;
  youtubeDownloadStage: string;
  setYoutubeDownloadState: (downloading: boolean, progress?: number, stage?: string) => void;

  // clip analysis & multi-clip marking
  clips: ClipSegment[];
  setClips: (c: ClipSegment[]) => void;
  selectedClipIdx: number | null;
  selectClip: (i: number | null) => void;

  markedClipIds: string[];
  activeClipId: string | null;
  clipConfigs: Record<string, EditState>;
  toggleMarkClip: (id: string) => void;
  markAllClips: () => void;
  unmarkAllClips: () => void;
  setActiveClipId: (id: string) => void;

  // assets
  fonts: FontAsset[];
  setFonts: (f: FontAsset[]) => void;
  sfxList: SfxAsset[];
  setSfxList: (s: SfxAsset[]) => void;
  styles: Record<string, { name: string }>;
  setStyles: (s: Record<string, { name: string }>) => void;

  // edit state (mirrors RenderParams)
  edit: EditState;
  setEdit: (patch: Partial<EditState>) => void;
  resetEdit: () => void;

  // render jobs
  renderJobId: string | null;
  setRenderJobId: (id: string | null) => void;
}

export const useStore = create<SupaisuStore>((set, get) => ({
  step: 1,
  setStep: (s) => set({ step: s }),

  youtubeUrl: '',
  youtubeVideoId: '',
  setYoutubeUrl: (u) => set({ youtubeUrl: u }),
  setYoutubeVideoId: (id) => set({ youtubeVideoId: id ?? '' }),
  setYoutubeSource: (url) => {
    const id = extractYouTubeId(url) ?? '';
    set({ youtubeUrl: url, youtubeVideoId: id });
  },
  youtubeInfo: null,
  setYoutubeInfo: (info) => set({ youtubeInfo: info }),
  ytJobId: null,
  setYtJobId: (id) => set({ ytJobId: id }),
  videoMeta: null,
  setVideoMeta: (m) => set({ videoMeta: m }),
  videoUrl: null,
  previewUrl: null,
  setVideoUrl: (url, preview) => set({ videoUrl: url, previewUrl: preview ?? url }),
  srtSource: 'none',
  setSrtSource: (s) => set({ srtSource: s }),

  isDownloadingYoutube: false,
  youtubeDownloadProgress: 0,
  youtubeDownloadStage: '',
  setYoutubeDownloadState: (downloading, progress = 0, stage = '') =>
    set({
      isDownloadingYoutube: downloading,
      youtubeDownloadProgress: progress,
      youtubeDownloadStage: stage,
    }),

  clips: [],
  setClips: (c) => {
    // Generate IDs if missing
    const withIds = c.map((item, idx) => ({
      ...item,
      id: item.id || `clip_${idx}_${Math.round(item.start)}_${Math.round(item.end)}`,
    }));

    const initialConfigs: Record<string, EditState> = {};
    const baseEdit = get().edit;
    withIds.forEach((clip) => {
      initialConfigs[clip.id!] = {
        ...baseEdit,
        clip_start: clip.start,
        clip_end: clip.end,
        hook_text: clip.suggested_hooks?.[0] || baseEdit.hook_text,
      };
    });

    const allIds = withIds.map((item) => item.id!);
    set({
      clips: withIds,
      markedClipIds: allIds, // default mark all
      activeClipId: allIds[0] || null,
      clipConfigs: initialConfigs,
    });
  },
  selectedClipIdx: null,
  selectClip: (i) => set({ selectedClipIdx: i }),

  markedClipIds: [],
  activeClipId: null,
  clipConfigs: {},

  toggleMarkClip: (id: string) => {
    const { markedClipIds, activeClipId } = get();
    const isMarked = markedClipIds.includes(id);
    const nextMarked = isMarked
      ? markedClipIds.filter((item) => item !== id)
      : [...markedClipIds, id];

    let nextActive = activeClipId;
    if (isMarked && activeClipId === id) {
      nextActive = nextMarked[0] || null;
    } else if (!isMarked && !activeClipId) {
      nextActive = id;
    }

    set({ markedClipIds: nextMarked });
    if (nextActive && nextActive !== activeClipId) {
      get().setActiveClipId(nextActive);
    }
  },

  markAllClips: () => {
    const { clips } = get();
    const allIds = clips.map((c) => c.id || '');
    set({ markedClipIds: allIds });
    if (allIds.length > 0 && !get().activeClipId) {
      get().setActiveClipId(allIds[0]);
    }
  },

  unmarkAllClips: () => {
    set({ markedClipIds: [] });
  },

  setActiveClipId: (id: string) => {
    const { clipConfigs, edit } = get();
    const config = clipConfigs[id];
    if (config) {
      set({
        activeClipId: id,
        edit: { ...config, video_filename: edit.video_filename || config.video_filename },
      });
    } else {
      set({ activeClipId: id });
    }
  },

  fonts: [],
  setFonts: (f) => set({ fonts: f }),
  sfxList: [],
  setSfxList: (s) => set({ sfxList: s }),
  styles: {},
  setStyles: (s) => set({ styles: s }),

  edit: { ...DEFAULT_EDIT_STATE },
  setEdit: (patch) => {
    set((state) => {
      const nextEdit = { ...state.edit, ...patch };
      const nextConfigs = { ...state.clipConfigs };
      if (state.activeClipId) {
        nextConfigs[state.activeClipId] = {
          ...(nextConfigs[state.activeClipId] || nextEdit),
          ...patch,
        };
      }
      return {
        edit: nextEdit,
        clipConfigs: nextConfigs,
      };
    });
  },
  resetEdit: () => set({ edit: { ...DEFAULT_EDIT_STATE } }),

  renderJobId: null,
  setRenderJobId: (id) => set({ renderJobId: id }),
}));
