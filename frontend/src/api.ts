import type {
  ClipSegment,
  EditState,
  FontAsset,
  SfxAsset,
  SubSource,
  VideoMeta,
  YouTubeInfo,
  YouTubeJobStatus,
  HookSuggestion,
} from './types';

const BASE = '';

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail ?? JSON.stringify(body);
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

// -------------------------------------------------------------
// YouTube Endpoints
// -------------------------------------------------------------

export function fetchYoutubeInfo(url: string): Promise<YouTubeInfo> {
  return apiFetch('/api/youtube/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

export function startYoutubeDownload(
  url: string,
  sub_lang: string,
  sub_source: SubSource,
): Promise<{ job_id: string }> {
  return apiFetch('/api/youtube/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, sub_lang, sub_source }),
  });
}

export function pollYoutubeStatus(job_id: string): Promise<YouTubeJobStatus> {
  return apiFetch(`/api/youtube/status/${job_id}`);
}

export function fetchYoutubeSubtitles(
  url: string,
  job_id: string,
  lang: string,
  source: 'manual' | 'auto',
): Promise<{ srt_text: string; srt_source: string }> {
  return apiFetch('/api/youtube/subtitles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, job_id, lang, source }),
  });
}

export function fetchYoutubeFrame(
  url: string,
  timestamp_sec: number,
): Promise<{ frame_url: string }> {
  return apiFetch('/api/youtube/frame', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, timestamp_sec }),
  });
}

// -------------------------------------------------------------
// Upload Endpoints
// -------------------------------------------------------------

export async function uploadProject(
  video: File,
  srt?: File,
): Promise<{
  job_id: string;
  video_filename: string;
  video_url: string;
  meta: VideoMeta;
  srt_text: string;
  srt_source: string;
}> {
  const fd = new FormData();
  fd.append('video', video);
  if (srt) fd.append('srt', srt);
  return apiFetch('/api/upload/project', { method: 'POST', body: fd });
}

export async function uploadSrt(
  srt: File,
): Promise<{ srt_text: string; cue_count: number; problems: Array<{ block: number; message: string }> }> {
  const fd = new FormData();
  fd.append('srt', srt);
  return apiFetch('/api/upload/srt', { method: 'POST', body: fd });
}

export async function uploadFont(font: File): Promise<FontAsset> {
  const fd = new FormData();
  fd.append('font', font);
  return apiFetch('/api/upload/font', { method: 'POST', body: fd });
}

export async function uploadSfx(sfx: File): Promise<SfxAsset> {
  const fd = new FormData();
  fd.append('sfx', sfx);
  return apiFetch('/api/upload/sfx', { method: 'POST', body: fd });
}

// -------------------------------------------------------------
// Assets & System Endpoints
// -------------------------------------------------------------

export function fetchAssets(): Promise<{
  styles: Record<string, { name: string; fontsize: number; primary: string }>;
  fonts: FontAsset[];
  sfx: SfxAsset[];
}> {
  return apiFetch('/api/assets');
}

export function fetchEncoders(): Promise<{
  available: string[];
  recommended: string;
  threads: number;
}> {
  return apiFetch('/api/system/encoders');
}

export function getHealth(): Promise<{
  status: string;
  root: string;
  ffmpeg: boolean;
  ffprobe: boolean;
  gemini_key: boolean;
  gemini_model: string;
}> {
  return apiFetch('/api/health');
}

// -------------------------------------------------------------
// AI Endpoints
// -------------------------------------------------------------

export function analyzeClips(
  srt_text: string,
  video_duration: number,
  language = 'Indonesian',
): Promise<{ clips: ClipSegment[] }> {
  return apiFetch('/api/ai/analyze-clips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ srt_text, video_duration, language }),
  });
}

export function generateHooks(
  srt_text: string,
  language = 'Indonesian',
  clip_start?: number | null,
  clip_end?: number | null,
): Promise<{ hooks: HookSuggestion[] }> {
  return apiFetch('/api/ai/generate-hooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ srt_text, language, clip_start, clip_end }),
  });
}

export function generateMetadata(
  srt_text: string,
  platform = 'TikTok',
  language = 'Indonesian',
  clip_start?: number | null,
  clip_end?: number | null,
): Promise<{ title: string; description: string; hashtags: string[] }> {
  return apiFetch('/api/ai/metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ srt_text, platform, language, clip_start, clip_end }),
  });
}

export function highlightWords(
  srt_text: string,
  clip_start?: number | null,
  clip_end?: number | null,
): Promise<{ words: string[] }> {
  return apiFetch('/api/ai/highlight-words', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ srt_text, clip_start, clip_end }),
  });
}

export function suggestStyle(
  srt_text: string,
  clip_start?: number | null,
  clip_end?: number | null,
): Promise<{ style_key: string; reason: string }> {
  return apiFetch('/api/ai/suggest-style', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ srt_text, clip_start, clip_end }),
  });
}

// -------------------------------------------------------------
// Preview & Render Endpoints
// -------------------------------------------------------------

export function getPreviewAss(
  params: EditState & { absolute_time?: boolean },
): Promise<{
  ass_text: string;
  play_res: { w: number; h: number };
  clip_start: number;
  clip_end: number;
  time_shift: number;
}> {
  return apiFetch('/api/preview/ass', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export function startRender(params: EditState): Promise<{ job_id: string }> {
  return apiFetch('/api/render/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export function pollRenderStatus(job_id: string): Promise<{
  job_id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  eta_sec: number | null;
  encoder: string | null;
  export_url: string | null;
  export_filename: string | null;
  error: string | null;
}> {
  return apiFetch(`/api/render/status/${job_id}`);
}

// -------------------------------------------------------------
// SRT utilities
// -------------------------------------------------------------

export function validateSrt(
  srt_text: string,
): Promise<{ cue_count: number; problems: Array<{ block: number; message: string }> }> {
  return apiFetch('/api/srt/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ srt_text }),
  });
}

export function parseSrt(
  srt_text: string,
): Promise<{
  entries: Array<{ start: number; end: number; text: string }>;
  problems: Array<{ block: number; message: string }>;
}> {
  return apiFetch('/api/srt/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ srt_text }),
  });
}

// -------------------------------------------------------------
// Video proxy
// -------------------------------------------------------------

export function getVideoProxy(
  video_filename: string,
): Promise<{ preview_url: string; is_proxy: boolean }> {
  return apiFetch('/api/video/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_filename }),
  });
}
