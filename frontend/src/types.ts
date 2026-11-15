// ============================================================
// EditState — mirrors backend RenderParams exactly.
// One source of truth. Add fields here AND in RenderParams together.
// ============================================================

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type NormalizedRect = Rect;

export interface WebcamStyle {
  border_px: number;
  border_color: string;
  radius_px: number;
}

export type LayoutMode = 'fill_crop' | 'blur_bg';
export type HookMode = 'box' | 'text' | 'clean';
export type HookAnimation = 'pop_bounce' | 'zoom_slam' | 'fade_slide_up' | 'typewriter_fade' | 'none';
export type HookLetterStyle = 'uppercase' | 'title' | 'lowercase';
export type SubtitleAnimation = 'none' | 'pop_in' | 'fade_up' | 'zoom_soft';
export type Resolution = 1080 | 720;
export type SubSource = 'manual' | 'auto' | 'none';
export type LetterStyle = 'uppercase' | 'title' | 'lowercase';
export type StyleKey =
  | 'viral_pop' | 'beast_punch' | 'cyber_violet' | 'fire_crimson'
  | 'electric_cyan' | 'golden_aura' | 'clean_minimal' | 'none'
  // legacy aliases kept for backward compat
  | 'hormozi_pop' | 'clean_white' | 'neon_cyber' | 'boxed_caption' | 'cinematic_minimal';

export interface EditState {
  // --- video source ---
  video_filename: string;
  youtube_url: string;          // NEW: for slice-on-export when no local file
  // --- segment & subtitle ---
  srt_text: string;
  srt_relative: boolean;
  clip_start: number;
  clip_end: number | null;
  style_key: StyleKey;
  font_family: string;
  font_size: number | null;
  primary_color: string | null;
  outline_color: string | null;
  subtitle_margin_v: number | null;
  highlight_words: string[];
  highlight_color: string;
  letter_style: LetterStyle;    // NEW: uppercase | title | lowercase
  // --- hook ---
  hook_text: string;
  hook_duration_sec: number;
  hook_y_margin: number;
  hook_font_size: number;
  hook_font_family: string;
  hook_color: string;
  hook_box_color: string;
  hook_mode: HookMode;
  hook_animation: HookAnimation;
  hook_letter_style: HookLetterStyle;
  // --- video layout ---
  layout_mode: LayoutMode;
  main_x_offset: number;
  main_y_offset: number;
  main_zoom: number;
  webcam_enabled: boolean;
  webcam_src: Rect | null;
  webcam_dst: Rect | null;
  webcam_style: WebcamStyle;
  // --- SFX ---
  sfx_filename: string;
  sfx_volume: number;
  sfx_start_sec: number;
  // --- subtitle animation ---
  subtitle_animation: SubtitleAnimation;
  // --- output ---
  resolution: Resolution;
  fps: number | null;
  crf: number;
  encoder: string;
  preview_seconds: number | null;
}

export const DEFAULT_EDIT_STATE: EditState = {
  video_filename: '',
  youtube_url: '',
  srt_text: '',
  srt_relative: false,
  clip_start: 0,
  clip_end: null,
  style_key: 'viral_pop',
  font_family: 'Arial',
  font_size: null,
  primary_color: null,
  outline_color: null,
  subtitle_margin_v: null,
  highlight_words: [],
  highlight_color: '#FF3B3B',
  letter_style: 'uppercase',
  hook_text: '',
  hook_duration_sec: 3,
  hook_y_margin: 180,
  hook_font_size: 74,
  hook_font_family: 'Arial',
  hook_color: '#FFFFFF',
  hook_box_color: '#121212',
  hook_mode: 'box',
  hook_animation: 'pop_bounce',
  hook_letter_style: 'uppercase',
  layout_mode: 'fill_crop',
  main_x_offset: 0.5,
  main_y_offset: 0.5,
  main_zoom: 1.0,
  webcam_enabled: false,
  webcam_src: null,
  webcam_dst: null,
  webcam_style: { border_px: 4, border_color: '#FFFFFF', radius_px: 16 },
  sfx_filename: '',
  sfx_volume: 0.85,
  sfx_start_sec: 0,
  subtitle_animation: 'pop_in',
  resolution: 1080,
  fps: null,
  crf: 20,
  encoder: 'auto',
  preview_seconds: null,
};

// ============================================================
// YouTube / Project types
// ============================================================

export interface SubtitleOption {
  lang: string;
  label: string;
  source: 'manual' | 'auto';
}

export interface VideoMeta {
  width: number;
  height: number;
  duration: number;
  fps: number;
  codec: string;
  has_audio: boolean;
  needs_proxy: boolean;
  orientation: 'landscape' | 'portrait';
}

export interface YouTubeInfo {
  title: string;
  uploader: string;
  duration: number;
  width: number;
  height: number;
  thumbnail: string;
  subs: { manual: SubtitleOption[]; auto: SubtitleOption[] };
  default_sub: SubtitleOption | null;
  srt_text?: string;
  srt_source?: string;
}

export interface YouTubeJobStatus {
  job_id: string;
  status: 'pending' | 'running' | 'downloading' | 'done' | 'error';
  stage?: string;
  progress?: number;
  error?: string;
  video_filename?: string;
  video_url?: string;
  meta?: VideoMeta;
  srt_text?: string;
  srt_source?: string;
  warnings?: string[];
}

export interface ClipSegment {
  id?: string;
  start: number;
  end: number;
  duration: number;
  title: string;
  virality_score: number;
  reason: string;
  suggested_hooks: string[];
}

export interface FontAsset {
  filename: string;
  family: string;
  url: string;
}

export interface SfxAsset {
  filename: string;
  url: string;
}

export interface StyleDef {
  name: string;
  fontsize: number;
  primary: string;
  outline: string;
  bold: number;
  alignment: number;
  margin_v: number;
}

export interface HookSuggestion {
  hook: string;
  recommended_seconds: number;
  reason: string;
}

export type Step = 1 | 2 | 3 | 4;
