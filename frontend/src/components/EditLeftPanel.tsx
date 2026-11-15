import { useState, useRef, useMemo, useEffect } from 'react';
import {
  FileText,
  Sparkles,
  Upload,
  Play,
  Square,
  Loader2,
  Scissors,
  Merge,
  Trash2,
  Plus,
  Search,
  Wand2,
  Code,
  LayoutList,
  Camera,
  CameraOff,
  Crop,
  RotateCcw,
} from 'lucide-react';
import { useStore } from '../store';
import { generateHooks, uploadSfx, fetchYoutubeFrame } from '../api';
import type { HookAnimation, HookMode, HookLetterStyle, Rect, NormalizedRect } from '../types';

const HOOK_PRESETS: { label: string; value: number }[] = [
  { label: '2 detik pertama', value: 2 },
  { label: '3 detik pertama', value: 3 },
  { label: '5 detik pertama', value: 5 },
  { label: '10 detik pertama', value: 10 },
  { label: 'Keseluruhan Video', value: 0 },
];

const BUILTIN_HOOK_FONTS = [
  'Montserrat',
  'Arial',
  'Impact',
  'Anton',
  'Poppins',
  'Bebas Neue',
  'Komika Axis',
  'The Bold Font',
];

const HOOK_ANIMATIONS: { key: HookAnimation; label: string; desc: string }[] = [
  { key: 'pop_bounce', label: 'Pop Bounce', desc: 'Muncul membal energik' },
  { key: 'zoom_slam', label: 'Zoom Slam', desc: 'Zoom cepat menghentak' },
  { key: 'fade_slide_up', label: 'Slide Up', desc: 'Meluncur ke atas & fade' },
  { key: 'typewriter_fade', label: 'Type Fade', desc: 'Fade halus ala ketikan' },
  { key: 'none', label: 'Static', desc: 'Tanpa animasi' },
];

// Helper format timestamp detik -> HH:MM:SS,mmm
function formatTimestamp(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 1000);
  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)},${pad(ms, 3)}`;
}

interface SubtitleCue {
  id: number;
  start: number;
  end: number;
  text: string;
}

function parseSrtToCues(srt: string): SubtitleCue[] {
  const blocks = (srt || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];
  let autoId = 1;

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const arrowLine = lines.find((l) => l.includes('-->'));
    if (!arrowLine) continue;

    const [a, b] = arrowLine.split('-->').map((s) => s.trim());
    const parseTs = (ts: string) => {
      const match = ts.match(/(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/);
      if (!match) return 0;
      const [, h, m, s, frac] = match;
      return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt(frac.padEnd(3, '0'), 10) / 1000;
    };

    const start = parseTs(a);
    const end = parseTs(b);
    const textLines = lines.slice(lines.indexOf(arrowLine) + 1);
    const text = textLines.join('\n');
    if (end > start) {
      cues.push({ id: autoId++, start, end, text });
    }
  }
  return cues;
}

function cuesToSrt(cues: SubtitleCue[]): string {
  return cues
    .map((c, i) => {
      const id = i + 1;
      const t1 = formatTimestamp(c.start);
      const t2 = formatTimestamp(c.end);
      return `${id}\n${t1} --> ${t2}\n${c.text.trim()}`;
    })
    .join('\n\n');
}

function wrapCueTextAuto(text: string, maxLines = 2, maxChars = 26): string {
  const words = text.replace(/\n+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const lines: string[] = [];
  let cur = '';

  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if ((cur + ' ' + w).length <= maxChars) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);

  if (lines.length > maxLines) {
    const firstPart = lines.slice(0, maxLines - 1);
    const rest = lines.slice(maxLines - 1).join(' ');
    return [...firstPart, rest].join('\n');
  }
  return lines.join('\n');
}

export default function EditLeftPanel() {
  const {
    edit,
    setEdit,
    fonts,
    sfxList,
    setSfxList,
    videoUrl,
    previewUrl,
    youtubeVideoId,
  } = useStore();

  // 3 Tab Navigasi Bersih: Captions, Hook & SFX, Webcam
  const [activeTab, setActiveTab] = useState<'captions' | 'hook_sfx' | 'webcam'>('captions');

  // AI Hook state
  const [loadingHooks, setLoadingHooks] = useState(false);
  const [hookSuggestions, setHookSuggestions] = useState<Array<{ hook: string; recommended_seconds: number; reason: string }>>([]);
  const [hookError, setHookError] = useState('');

  // SRT Editor state
  const [srtViewMode, setSrtViewMode] = useState<'cards' | 'raw'>('cards');
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');

  // SFX audio preview player
  const [playingSfx, setPlayingSfx] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Upload refs
  const sfxInputRef = useRef<HTMLInputElement>(null);
  const [uploadingSfx, setUploadingSfx] = useState(false);

  // Klip rentang waktu
  const clipStart = edit.clip_start;
  const clipEnd = edit.clip_end ?? null;
  const clipDuration = clipEnd !== null ? Math.max(0, clipEnd - clipStart) : null;

  // Parse ALL cues from store's srt_text
  const allCues = useMemo(() => parseSrtToCues(edit.srt_text), [edit.srt_text]);

  // Filter + shift cues ke waktu RELATIF KLIP
  const cues = useMemo((): SubtitleCue[] => {
    if (edit.srt_relative) {
      return allCues;
    }
    if (clipEnd === null) {
      return allCues.map((c, i) => ({
        ...c,
        id: i + 1,
        start: Math.max(0, c.start - clipStart),
        end: Math.max(0.1, c.end - clipStart),
      })).filter((c) => c.end > 0);
    }
    return allCues
      .filter((c) => c.end > clipStart && c.start < clipEnd!)
      .map((c, i) => ({
        ...c,
        id: i + 1,
        start: Math.max(0, parseFloat((c.start - clipStart).toFixed(3))),
        end: Math.min(clipDuration!, parseFloat((c.end - clipStart).toFixed(3))),
      }));
  }, [allCues, edit.srt_relative, clipStart, clipEnd, clipDuration]);

  // Simpan cue ke store sebagai SRT relatif klip
  const updateCues = (newCues: SubtitleCue[]) => {
    const newSrt = cuesToSrt(newCues);
    setEdit({ srt_text: newSrt, srt_relative: true });
  };

  const handleCueTextChange = (index: number, newText: string) => {
    const next = [...cues];
    next[index] = { ...next[index], text: newText };
    updateCues(next);
  };

  const handleShiftTime = (index: number, field: 'start' | 'end', delta: number) => {
    const next = [...cues];
    const cue = { ...next[index] };
    if (field === 'start') {
      cue.start = Math.max(0, parseFloat((cue.start + delta).toFixed(2)));
      if (cue.start >= cue.end) {
        cue.end = parseFloat((cue.start + 0.2).toFixed(2));
      }
    } else {
      cue.end = Math.max(parseFloat((cue.start + 0.1).toFixed(2)), parseFloat((cue.end + delta).toFixed(2)));
    }
    next[index] = cue;
    updateCues(next);
  };

  const handleSplitCue = (index: number) => {
    const cue = cues[index];
    if (!cue) return;
    const words = cue.text.trim().split(/\s+/).filter(Boolean);
    if (words.length <= 1 && cue.text.length <= 4) {
      alert('Teks terlalu pendek untuk dipecah.');
      return;
    }

    let text1 = '';
    let text2 = '';
    if (words.length > 1) {
      const mid = Math.ceil(words.length / 2);
      text1 = words.slice(0, mid).join(' ');
      text2 = words.slice(mid).join(' ');
    } else {
      const mid = Math.ceil(cue.text.length / 2);
      text1 = cue.text.slice(0, mid);
      text2 = cue.text.slice(mid);
    }

    const totalDur = Math.max(0.2, cue.end - cue.start);
    const ratio = Math.max(0.2, Math.min(0.8, text1.length / (cue.text.length || 1)));
    const splitTime = parseFloat((cue.start + totalDur * ratio).toFixed(2));

    const cue1: SubtitleCue = {
      id: cue.id,
      start: cue.start,
      end: splitTime,
      text: text1,
    };
    const cue2: SubtitleCue = {
      id: cue.id + 1,
      start: splitTime,
      end: cue.end,
      text: text2,
    };

    const next = [...cues.slice(0, index), cue1, cue2, ...cues.slice(index + 1)];
    updateCues(next);
  };

  const handleMergeNext = (index: number) => {
    if (index >= cues.length - 1) return;
    const cur = cues[index];
    const nxt = cues[index + 1];

    const mergedCue: SubtitleCue = {
      id: cur.id,
      start: cur.start,
      end: nxt.end,
      text: `${cur.text.trim()} ${nxt.text.trim()}`,
    };

    const next = [...cues.slice(0, index), mergedCue, ...cues.slice(index + 2)];
    updateCues(next);
  };

  const handleDeleteCue = (index: number) => {
    const next = cues.filter((_, i) => i !== index);
    updateCues(next);
  };

  const handleAddCue = () => {
    const lastCue = cues[cues.length - 1];
    const start = lastCue ? parseFloat((lastCue.end + 0.1).toFixed(2)) : 0;
    const end = parseFloat((start + 2.5).toFixed(2));
    const newCue: SubtitleCue = {
      id: (lastCue?.id || 0) + 1,
      start,
      end,
      text: 'Teks subtitle baru',
    };
    updateCues([...cues, newCue]);
  };

  const handleAutoClean = () => {
    const next: SubtitleCue[] = [];
    for (const c of cues) {
      const words = c.text.trim().split(/\s+/).filter(Boolean);
      if (words.length >= 8 && c.end - c.start >= 3.0) {
        const mid = Math.ceil(words.length / 2);
        const t1 = wrapCueTextAuto(words.slice(0, mid).join(' '));
        const t2 = wrapCueTextAuto(words.slice(mid).join(' '));
        const dur = c.end - c.start;
        const midT = parseFloat((c.start + dur * 0.5).toFixed(2));
        next.push({ id: next.length + 1, start: c.start, end: midT, text: t1 });
        next.push({ id: next.length + 1, start: midT, end: c.end, text: t2 });
      } else {
        next.push({
          id: next.length + 1,
          start: c.start,
          end: c.end,
          text: wrapCueTextAuto(c.text),
        });
      }
    }
    updateCues(next);
  };

  const handleFindReplaceAll = () => {
    if (!searchQuery.trim()) return;
    const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let replaceCount = 0;
    const next = cues.map((c) => {
      const newText = c.text.replace(regex, () => {
        replaceCount++;
        return replaceQuery;
      });
      return { ...c, text: newText };
    });
    updateCues(next);
    alert(`Berhasil mengganti ${replaceCount} kata "${searchQuery}".`);
  };

  const handleGenerateHooks = async () => {
    if (!edit.srt_text.trim()) {
      setHookError('Subtitle SRT kosong. Pastikan ada transkrip.');
      return;
    }
    setLoadingHooks(true);
    setHookError('');
    try {
      const res = await generateHooks(edit.srt_text, 'Indonesian', edit.clip_start, edit.clip_end);
      setHookSuggestions(res.hooks || []);
    } catch (e: unknown) {
      setHookError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingHooks(false);
    }
  };

  const togglePlaySfx = () => {
    const sfx = sfxList.find((s) => s.filename === edit.sfx_filename);
    if (!sfx) return;

    if (playingSfx && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlayingSfx(false);
      return;
    }

    const audio = new Audio(sfx.url);
    audio.volume = Math.min(1.0, edit.sfx_volume);
    audioRef.current = audio;
    audio.play();
    setPlayingSfx(true);
    audio.onended = () => setPlayingSfx(false);
  };

  const handleSfxUpload = async (file: File) => {
    setUploadingSfx(true);
    try {
      const data = await uploadSfx(file);
      setSfxList([...sfxList, data]);
      setEdit({ sfx_filename: data.filename });
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingSfx(false);
    }
  };

  // -------------------------------------------------------------
  // Webcam Source Frame Drag & Resize Logic
  // -------------------------------------------------------------
  const isYoutubeMode = !videoUrl && Boolean(youtubeVideoId);
  const [ytFrameUrl, setYtFrameUrl] = useState<string | null>(null);
  const sourceFrameRef = useRef<HTMLDivElement>(null);
  const [draggingSrc, setDraggingSrc] = useState(false);

  const currentSrc: NormalizedRect = edit.webcam_src || { x: 0.02, y: 0.65, w: 0.28, h: 0.32 };
  const currentDst: Rect = edit.webcam_dst || { x: 40, y: 80, w: 320, h: 320 };

  // Fetch frame tengah video untuk YouTube
  useEffect(() => {
    if (!isYoutubeMode || !youtubeVideoId) return;
    const url = edit.youtube_url || `https://www.youtube.com/watch?v=${youtubeVideoId}`;
    const midPoint = (edit.clip_start + (edit.clip_end ?? (edit.clip_start + 30))) / 2;
    fetchYoutubeFrame(url, midPoint)
      .then((res) => {
        if (res.frame_url) setYtFrameUrl(res.frame_url);
      })
      .catch(() => {
        setYtFrameUrl(`https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`);
      });
  }, [isYoutubeMode, youtubeVideoId, edit.youtube_url, edit.clip_start, edit.clip_end]);

  const dragSrcRef = useRef<{ mouseX: number; mouseY: number; rect: NormalizedRect; boxW: number; boxH: number }>({
    mouseX: 0,
    mouseY: 0,
    rect: { x: 0.02, y: 0.65, w: 0.28, h: 0.32 },
    boxW: 1,
    boxH: 1,
  });

  const handleSrcMouseDown = (e: React.MouseEvent, handle?: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (!sourceFrameRef.current) return;
    const boxRect = sourceFrameRef.current.getBoundingClientRect();

    dragSrcRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      rect: { ...currentSrc },
      boxW: boxRect.width,
      boxH: boxRect.height,
    };

    if (!handle) setDraggingSrc(true);

    const onMouseMove = (ev: MouseEvent) => {
      const { mouseX, mouseY, rect: start, boxW, boxH } = dragSrcRef.current;
      const dxNorm = (ev.clientX - mouseX) / boxW;
      const dyNorm = (ev.clientY - mouseY) / boxH;

      if (!handle) {
        const nx = Math.max(0, Math.min(1.0 - start.w, start.x + dxNorm));
        const ny = Math.max(0, Math.min(1.0 - start.h, start.y + dyNorm));
        setEdit({
          webcam_src: {
            x: Number(nx.toFixed(3)),
            y: Number(ny.toFixed(3)),
            w: start.w,
            h: start.h,
          },
        });
      } else {
        let nw = start.w;
        let nh = start.h;
        let nx = start.x;
        let ny = start.y;

        if (handle.includes('e')) nw = Math.max(0.08, Math.min(1.0 - start.x, start.w + dxNorm));
        if (handle.includes('s')) nh = Math.max(0.08, Math.min(1.0 - start.y, start.h + dyNorm));
        if (handle.includes('w')) {
          const diff = Math.min(start.w - 0.08, dxNorm);
          nx = start.x + diff;
          nw = start.w - diff;
        }
        if (handle.includes('n')) {
          const diff = Math.min(start.h - 0.08, dyNorm);
          ny = start.y + diff;
          nh = start.h - diff;
        }

        setEdit({
          webcam_src: {
            x: Number(nx.toFixed(3)),
            y: Number(ny.toFixed(3)),
            w: Number(nw.toFixed(3)),
            h: Number(nh.toFixed(3)),
          },
        });
      }
    };

    const onMouseUp = () => {
      setDraggingSrc(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const applyWebcamSrcPreset = (preset: 'bottom_left' | 'bottom_right' | 'top_left' | 'top_right') => {
    switch (preset) {
      case 'bottom_left':
        setEdit({ webcam_src: { x: 0.02, y: 0.65, w: 0.28, h: 0.32 } });
        break;
      case 'bottom_right':
        setEdit({ webcam_src: { x: 0.70, y: 0.65, w: 0.28, h: 0.32 } });
        break;
      case 'top_left':
        setEdit({ webcam_src: { x: 0.02, y: 0.05, w: 0.28, h: 0.32 } });
        break;
      case 'top_right':
        setEdit({ webcam_src: { x: 0.70, y: 0.05, w: 0.28, h: 0.32 } });
        break;
    }
  };

  return (
    <div
      style={{
        width: 350,
        background: '#12121A',
        borderRight: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Sub-tab Navigation (3 Tabs) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: '#0B0B10',
        }}
      >
        <button
          onClick={() => setActiveTab('captions')}
          style={{
            padding: '14px 8px',
            background: activeTab === 'captions' ? '#12121A' : 'transparent',
            color: activeTab === 'captions' ? '#C6FF3D' : '#7A7A8A',
            border: 'none',
            borderBottom: activeTab === 'captions' ? '2px solid #C6FF3D' : '2px solid transparent',
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 800,
            fontSize: 11,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            transition: 'all 0.15s ease',
          }}
        >
          <FileText size={14} />
          CAPTIONS
        </button>

        <button
          onClick={() => setActiveTab('hook_sfx')}
          style={{
            padding: '14px 8px',
            background: activeTab === 'hook_sfx' ? '#12121A' : 'transparent',
            color: activeTab === 'hook_sfx' ? '#C6FF3D' : '#7A7A8A',
            border: 'none',
            borderBottom: activeTab === 'hook_sfx' ? '2px solid #C6FF3D' : '2px solid transparent',
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 800,
            fontSize: 11,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            transition: 'all 0.15s ease',
          }}
        >
          <Sparkles size={14} />
          HOOK &amp; SFX
        </button>

        <button
          onClick={() => setActiveTab('webcam')}
          style={{
            padding: '14px 8px',
            background: activeTab === 'webcam' ? '#12121A' : 'transparent',
            color: activeTab === 'webcam' ? '#C6FF3D' : '#7A7A8A',
            border: 'none',
            borderBottom: activeTab === 'webcam' ? '2px solid #C6FF3D' : '2px solid transparent',
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 800,
            fontSize: 11,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            transition: 'all 0.15s ease',
          }}
        >
          <Camera size={14} />
          WEBCAM
        </button>
      </div>

      {/* Tab Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* ================= TAB 1: CAPTIONS ================= */}
        {activeTab === 'captions' && (
          <>
            <div>
              <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 13, color: '#E8E8F0', marginBottom: 4 }}>
                Editor Subtitle Interaktif
              </div>
              <div style={{ fontSize: 11, color: '#7A7A8A', lineHeight: 1.5 }}>
                {edit.srt_relative
                  ? `Menampilkan ${cues.length} cue relatif klip (waktu mulai dari 00:00.0).`
                  : clipEnd !== null
                  ? `Menampilkan ${cues.length} cue dalam rentang klip ${clipStart.toFixed(1)}s – ${clipEnd.toFixed(1)}s.`
                  : `Menampilkan ${cues.length} cue. Edit perkata, geser timing, split, merge, atau rapikan baris.`}
              </div>
            </div>

            {/* Toolbar Atas Editor SRT */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#0B0B10', padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ display: 'flex', gap: 4, background: '#171720', padding: 2, borderRadius: 6 }}>
                  <button
                    onClick={() => setSrtViewMode('cards')}
                    title="Tampilan Kartu Per Cue"
                    style={{
                      padding: '4px 8px',
                      borderRadius: 4,
                      border: 'none',
                      background: srtViewMode === 'cards' ? '#C6FF3D' : 'transparent',
                      color: srtViewMode === 'cards' ? '#0B0B10' : '#7A7A8A',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <LayoutList size={12} />
                    Kartu ({cues.length})
                  </button>
                  <button
                    onClick={() => setSrtViewMode('raw')}
                    title="Tampilan Teks Mentah SRT"
                    style={{
                      padding: '4px 8px',
                      borderRadius: 4,
                      border: 'none',
                      background: srtViewMode === 'raw' ? '#C6FF3D' : 'transparent',
                      color: srtViewMode === 'raw' ? '#0B0B10' : '#7A7A8A',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Code size={12} />
                    Raw SRT
                  </button>
                </div>

                <button
                  onClick={() => setShowFindReplace((v) => !v)}
                  title="Cari & Ganti Kata"
                  style={{
                    padding: '4px 8px',
                    borderRadius: 5,
                    border: showFindReplace ? '1px solid #C6FF3D' : '1px solid rgba(255,255,255,0.1)',
                    background: showFindReplace ? 'rgba(198,255,61,0.12)' : 'transparent',
                    color: showFindReplace ? '#C6FF3D' : '#E8E8F0',
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Search size={12} />
                  Find
                </button>
              </div>

              {/* Action Toolbar: Auto-Rapikan & Tambah Cue */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={handleAutoClean}
                  title="Rapikan subtitle otomatis (maksimal 2 baris, potong segmen terlalu panjang)"
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '6px 8px',
                    borderRadius: 5,
                    border: '1px solid rgba(198,255,61,0.3)',
                    background: 'rgba(198,255,61,0.08)',
                    color: '#C6FF3D',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <Wand2 size={12} />
                  Auto-Rapikan (Max 2 Baris)
                </button>

                <button
                  onClick={handleAddCue}
                  title="Tambah cue baru di akhir"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    padding: '6px 10px',
                    borderRadius: 5,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: '#171720',
                    color: '#E8E8F0',
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={12} />
                  Tambah
                </button>
              </div>

              {/* Bar Find & Replace */}
              {showFindReplace && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <input
                      type="text"
                      placeholder="Cari kata..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{
                        background: '#171720',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 4,
                        padding: '4px 6px',
                        fontSize: 10,
                        color: '#E8E8F0',
                        outline: 'none',
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Ganti dengan..."
                      value={replaceQuery}
                      onChange={(e) => setReplaceQuery(e.target.value)}
                      style={{
                        background: '#171720',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 4,
                        padding: '4px 6px',
                        fontSize: 10,
                        color: '#E8E8F0',
                        outline: 'none',
                      }}
                    />
                  </div>
                  <button
                    onClick={handleFindReplaceAll}
                    style={{
                      background: '#C6FF3D',
                      color: '#0B0B10',
                      border: 'none',
                      borderRadius: 4,
                      padding: '4px 8px',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Ganti Semua Kemunculan
                  </button>
                </div>
              )}
            </div>

            {/* Mode Kartu */}
            {srtViewMode === 'cards' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {cues.map((cue, idx) => {
                  const dur = Math.max(0, cue.end - cue.start);
                  return (
                    <div
                      key={cue.id || idx}
                      style={{
                        background: '#14141D',
                        border: '1px solid rgba(255,255,255,0.07)',
                        borderRadius: 8,
                        padding: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: '#C6FF3D', background: 'rgba(198,255,61,0.12)', padding: '2px 5px', borderRadius: 4 }}>
                            #{idx + 1}
                          </span>
                          <span style={{ fontSize: 10, color: '#7A7A8A', fontFamily: "'JetBrains Mono', monospace" }}>
                            {dur.toFixed(1)}s
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', background: '#0B0B10', borderRadius: 4, padding: '1px 4px' }}>
                            <span style={{ fontSize: 9, color: '#7A7A8A', marginRight: 2 }}>In</span>
                            <button
                              onClick={() => handleShiftTime(idx, 'start', -0.1)}
                              title="Kurangi 0.1s"
                              style={{ border: 'none', background: 'transparent', color: '#E8E8F0', cursor: 'pointer', fontSize: 10, padding: '0 2px' }}
                            >
                              -
                            </button>
                            <span style={{ fontSize: 9, color: '#C6FF3D', fontFamily: 'monospace' }}>{cue.start.toFixed(1)}</span>
                            <button
                              onClick={() => handleShiftTime(idx, 'start', 0.1)}
                              title="Tambah 0.1s"
                              style={{ border: 'none', background: 'transparent', color: '#E8E8F0', cursor: 'pointer', fontSize: 10, padding: '0 2px' }}
                            >
                              +
                            </button>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', background: '#0B0B10', borderRadius: 4, padding: '1px 4px' }}>
                            <span style={{ fontSize: 9, color: '#7A7A8A', marginRight: 2 }}>Out</span>
                            <button
                              onClick={() => handleShiftTime(idx, 'end', -0.1)}
                              title="Kurangi 0.1s"
                              style={{ border: 'none', background: 'transparent', color: '#E8E8F0', cursor: 'pointer', fontSize: 10, padding: '0 2px' }}
                            >
                              -
                            </button>
                            <span style={{ fontSize: 9, color: '#C6FF3D', fontFamily: 'monospace' }}>{cue.end.toFixed(1)}</span>
                            <button
                              onClick={() => handleShiftTime(idx, 'end', 0.1)}
                              title="Tambah 0.1s"
                              style={{ border: 'none', background: 'transparent', color: '#E8E8F0', cursor: 'pointer', fontSize: 10, padding: '0 2px' }}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>

                      <textarea
                        value={cue.text}
                        onChange={(e) => handleCueTextChange(idx, e.target.value)}
                        placeholder="Teks subtitle..."
                        style={{
                          width: '100%',
                          minHeight: 44,
                          background: '#0B0B10',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: 6,
                          padding: 6,
                          color: '#FFFFFF',
                          fontSize: 12,
                          fontFamily: edit.font_family || 'Arial',
                          fontWeight: 600,
                          lineHeight: 1.3,
                          outline: 'none',
                          resize: 'none',
                        }}
                      />

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2 }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            onClick={() => handleSplitCue(idx)}
                            title="Bagi 2 teks & durasi secara proporsional"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '3px 7px',
                              borderRadius: 4,
                              border: '1px solid rgba(255,255,255,0.08)',
                              background: '#1A1A24',
                              color: '#E8E8F0',
                              fontSize: 10,
                              cursor: 'pointer',
                            }}
                          >
                            <Scissors size={11} style={{ color: '#C6FF3D' }} />
                            Bagi 2
                          </button>

                          {idx < cues.length - 1 && (
                            <button
                              onClick={() => handleMergeNext(idx)}
                              title="Gabungkan dengan cue berikutnya"
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '3px 7px',
                                borderRadius: 4,
                                border: '1px solid rgba(255,255,255,0.08)',
                                background: '#1A1A24',
                                color: '#E8E8F0',
                                fontSize: 10,
                                cursor: 'pointer',
                              }}
                            >
                              <Merge size={11} style={{ color: '#C6FF3D' }} />
                              Gabung
                            </button>
                          )}
                        </div>

                        <button
                          onClick={() => handleDeleteCue(idx)}
                          title="Hapus baris subtitle ini"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '3px 7px',
                            borderRadius: 4,
                            border: '1px solid rgba(255,70,70,0.2)',
                            background: 'rgba(255,70,70,0.08)',
                            color: '#FF6B6B',
                            fontSize: 10,
                            cursor: 'pointer',
                          }}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <textarea
                value={edit.srt_text}
                onChange={(e) => setEdit({ srt_text: e.target.value })}
                placeholder="Format SRT mentah..."
                style={{
                  width: '100%',
                  flex: 1,
                  minHeight: 320,
                  background: '#0B0B10',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 8,
                  padding: 10,
                  color: '#E8E8F0',
                  fontSize: 11,
                  fontFamily: "'JetBrains Mono', monospace",
                  lineHeight: 1.6,
                  outline: 'none',
                  resize: 'none',
                }}
              />
            )}
          </>
        )}

        {/* ================= TAB 2: HOOK & SFX ================= */}
        {activeTab === 'hook_sfx' && (
          <>
            <div>
              <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 13, color: '#E8E8F0', marginBottom: 4 }}>
                Hook Teks &amp; Animasi
              </div>
              <div style={{ fontSize: 11, color: '#7A7A8A', lineHeight: 1.5 }}>
                Kalimat pancingan di detik awal klip dengan efek animasi pop-out.
              </div>
            </div>

            {/* Tombol AI Hook */}
            <button
              onClick={handleGenerateHooks}
              disabled={loadingHooks}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '10px 14px',
                borderRadius: 8,
                border: 'none',
                background: 'rgba(198,255,61,0.15)',
                color: '#C6FF3D',
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 700,
                fontSize: 11,
                cursor: loadingHooks ? 'not-allowed' : 'pointer',
              }}
            >
              {loadingHooks ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              Generate Hook dengan Gemini AI
            </button>

            {hookError && <div style={{ color: '#FF5A36', fontSize: 11 }}>{hookError}</div>}

            {/* Rekomendasi Hook AI */}
            {hookSuggestions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {hookSuggestions.map((s, i) => (
                  <div
                    key={i}
                    onClick={() => setEdit({ hook_text: s.hook, hook_duration_sec: s.recommended_seconds })}
                    style={{
                      background: '#17171F',
                      border: edit.hook_text === s.hook ? '1px solid #C6FF3D' : '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#E8E8F0' }}>"{s.hook}"</div>
                    <div style={{ fontSize: 10, color: '#7A7A8A', marginTop: 4 }}>
                      ⏱ {s.recommended_seconds}s · {s.reason}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Input Manual Teks Hook */}
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#7A7A8A', marginBottom: 4, fontWeight: 600 }}>
                TEKS HOOK
              </label>
              <textarea
                value={edit.hook_text}
                onChange={(e) => setEdit({ hook_text: e.target.value })}
                placeholder="Ketik teks hook pembuka..."
                style={{
                  width: '100%',
                  height: 56,
                  background: '#0B0B10',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 6,
                  padding: 8,
                  color: '#E8E8F0',
                  fontSize: 12,
                  outline: 'none',
                  resize: 'none',
                }}
              />
            </div>

            {/* Durasi Hook */}
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#7A7A8A', marginBottom: 4, fontWeight: 600 }}>
                DURASI TAMPIL HOOK
              </label>
              <select
                value={edit.hook_duration_sec}
                onChange={(e) => setEdit({ hook_duration_sec: parseFloat(e.target.value) })}
                style={{
                  width: '100%',
                  background: '#0B0B10',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 6,
                  color: '#E8E8F0',
                  padding: '8px 10px',
                  fontSize: 12,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {HOOK_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Animasi Masuk Hook */}
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#7A7A8A', marginBottom: 6, fontWeight: 600 }}>
                ANIMASI MASUK HOOK
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {HOOK_ANIMATIONS.map((anim) => {
                  const isActive = (edit.hook_animation ?? 'pop_bounce') === anim.key;
                  return (
                    <button
                      key={anim.key}
                      onClick={() => setEdit({ hook_animation: anim.key })}
                      title={anim.desc}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: isActive ? '1px solid #C6FF3D' : '1px solid rgba(255,255,255,0.08)',
                        background: isActive ? 'rgba(198,255,61,0.12)' : '#171720',
                        color: isActive ? '#C6FF3D' : '#E8E8F0',
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{anim.label}</div>
                      <div style={{ fontSize: 9, color: isActive ? '#C6FF3D' : '#7A7A8A', marginTop: 2 }}>{anim.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Gaya Latar Hook & Letter Style */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#7A7A8A', marginBottom: 6, fontWeight: 600 }}>
                  GAYA LATAR
                </label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[
                    { mode: 'box' as HookMode, label: 'Box' },
                    { mode: 'text' as HookMode, label: 'Text' },
                    { mode: 'clean' as HookMode, label: 'Clean' },
                  ].map((item) => {
                    const isActive = (edit.hook_mode ?? 'box') === item.mode;
                    return (
                      <button
                        key={item.mode}
                        onClick={() => setEdit({ hook_mode: item.mode })}
                        style={{
                          flex: 1,
                          padding: '6px 2px',
                          borderRadius: 6,
                          border: isActive ? '1px solid #C6FF3D' : '1px solid rgba(255,255,255,0.1)',
                          background: isActive ? 'rgba(198,255,61,0.12)' : 'transparent',
                          color: isActive ? '#C6FF3D' : '#7A7A8A',
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#7A7A8A', marginBottom: 6, fontWeight: 600 }}>
                  LETTER CASE
                </label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[
                    { key: 'uppercase' as HookLetterStyle, label: 'ABC' },
                    { key: 'title' as HookLetterStyle, label: 'Abc' },
                    { key: 'lowercase' as HookLetterStyle, label: 'abc' },
                  ].map((btn) => {
                    const isSelected = (edit.hook_letter_style ?? 'uppercase') === btn.key;
                    return (
                      <button
                        key={btn.key}
                        onClick={() => setEdit({ hook_letter_style: btn.key })}
                        style={{
                          flex: 1,
                          padding: '6px 2px',
                          borderRadius: 6,
                          border: isSelected ? '1px solid #C6FF3D' : '1px solid rgba(255,255,255,0.08)',
                          background: isSelected ? 'rgba(198,255,61,0.12)' : '#171720',
                          color: isSelected ? '#C6FF3D' : '#A0A0B0',
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {btn.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Font Hook, Warna Teks & Warna Box */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 8 }}>
              <div>
                <label style={{ display: 'block', fontSize: 10, color: '#7A7A8A', marginBottom: 4, fontWeight: 600 }}>
                  FONT HOOK
                </label>
                <select
                  value={edit.hook_font_family || edit.font_family || 'Arial'}
                  onChange={(e) => setEdit({ hook_font_family: e.target.value })}
                  style={{
                    width: '100%',
                    background: '#0B0B10',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 6,
                    color: '#E8E8F0',
                    padding: '6px 8px',
                    fontSize: 11,
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <optgroup label="Font Bawaan">
                    {BUILTIN_HOOK_FONTS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </optgroup>
                  {fonts.length > 0 && (
                    <optgroup label="Font Upload">
                      {fonts.map((f) => (
                        <option key={f.family} value={f.family}>
                          {f.family}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 10, color: '#7A7A8A', marginBottom: 4, fontWeight: 600 }}>
                  WARNA TEKS
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0B0B10', padding: '4px 6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)' }}>
                  <input
                    type="color"
                    value={edit.hook_color || '#FFFFFF'}
                    onChange={(e) => setEdit({ hook_color: e.target.value })}
                    style={{ width: 20, height: 20, border: 'none', background: 'transparent', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#E8E8F0' }}>{edit.hook_color || '#FFFFFF'}</span>
                </div>
              </div>
            </div>

            {(edit.hook_mode ?? 'box') === 'box' && (
              <div>
                <label style={{ display: 'block', fontSize: 10, color: '#7A7A8A', marginBottom: 4, fontWeight: 600 }}>
                  WARNA BOX LATAR
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0B0B10', padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)' }}>
                  <input
                    type="color"
                    value={edit.hook_box_color || '#121212'}
                    onChange={(e) => setEdit({ hook_box_color: e.target.value })}
                    style={{ width: 22, height: 22, border: 'none', background: 'transparent', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#E8E8F0' }}>{edit.hook_box_color || '#121212'}</span>
                </div>
              </div>
            )}

            {/* Slider Ukuran & Posisi Vertikal Hook */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#7A7A8A', marginBottom: 4 }}>
                <span>UKURAN FONT HOOK</span>
                <span style={{ color: '#C6FF3D' }}>{edit.hook_font_size}px</span>
              </div>
              <input
                type="range"
                min={32}
                max={140}
                step={2}
                value={edit.hook_font_size}
                onChange={(e) => setEdit({ hook_font_size: parseInt(e.target.value, 10) })}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#7A7A8A', marginBottom: 4 }}>
                <span>POSISI VERTIKAL HOOK</span>
                <span style={{ color: '#C6FF3D' }}>{edit.hook_y_margin}px</span>
              </div>
              <input
                type="range"
                min={60}
                max={900}
                step={10}
                value={edit.hook_y_margin}
                onChange={(e) => setEdit({ hook_y_margin: parseInt(e.target.value, 10) })}
                style={{ width: '100%' }}
              />
            </div>

            {/* Pemisah ke SFX */}
            <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />

            <div>
              <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 13, color: '#E8E8F0', marginBottom: 4 }}>
                Sound Effect (SFX)
              </div>
              <div style={{ fontSize: 11, color: '#7A7A8A', lineHeight: 1.5 }}>
                Audio punchy untuk memperkuat hook di detik awal.
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#7A7A8A', marginBottom: 4, fontWeight: 600 }}>
                PILIH SFX
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={edit.sfx_filename}
                  onChange={(e) => setEdit({ sfx_filename: e.target.value })}
                  style={{
                    flex: 1,
                    background: '#0B0B10',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 6,
                    color: '#E8E8F0',
                    padding: '8px 10px',
                    fontSize: 12,
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="">— Tanpa SFX —</option>
                  {sfxList.map((s) => (
                    <option key={s.filename} value={s.filename}>
                      {s.filename}
                    </option>
                  ))}
                </select>

                <button
                  onClick={togglePlaySfx}
                  disabled={!edit.sfx_filename}
                  title="Preview Audio SFX"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 6,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: '#17171F',
                    color: edit.sfx_filename ? '#C6FF3D' : '#4A4A5A',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: edit.sfx_filename ? 'pointer' : 'not-allowed',
                  }}
                >
                  {playingSfx ? <Square size={14} /> : <Play size={14} />}
                </button>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#7A7A8A', marginBottom: 4 }}>
                <span>VOLUME SFX</span>
                <span style={{ color: '#C6FF3D' }}>{Math.round(edit.sfx_volume * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={2.0}
                step={0.05}
                value={edit.sfx_volume}
                onChange={(e) => setEdit({ sfx_volume: parseFloat(e.target.value) })}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#7A7A8A', marginBottom: 4 }}>
                <span>MULAI PADA DETIK KE-</span>
                <span style={{ color: '#C6FF3D' }}>{edit.sfx_start_sec.toFixed(1)}s</span>
              </div>
              <input
                type="range"
                min={0}
                max={10.0}
                step={0.1}
                value={edit.sfx_start_sec}
                onChange={(e) => setEdit({ sfx_start_sec: parseFloat(e.target.value) })}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <input
                ref={sfxInputRef}
                type="file"
                accept=".wav,.mp3,.ogg"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleSfxUpload(f);
                }}
              />
              <button
                onClick={() => sfxInputRef.current?.click()}
                disabled={uploadingSfx}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '9px 12px',
                  borderRadius: 6,
                  border: '1px dashed rgba(255,255,255,0.2)',
                  background: 'transparent',
                  color: '#E8E8F0',
                  fontSize: 11,
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {uploadingSfx ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                Upload Custom SFX (.wav / .mp3)
              </button>
            </div>
          </>
        )}

        {/* ================= TAB 3: WEBCAM POPOUT ================= */}
        {activeTab === 'webcam' && (
          <>
            <div>
              <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 13, color: '#E8E8F0', marginBottom: 4 }}>
                Webcam Popout &amp; Framing
              </div>
              <div style={{ fontSize: 11, color: '#7A7A8A', lineHeight: 1.5 }}>
                Sorot wajah streamer dari video asli untuk ditampilkan melayang di video 9:16.
              </div>
            </div>

            {/* Toggle Webcam Popout */}
            <button
              onClick={() => {
                const next = !edit.webcam_enabled;
                setEdit({
                  webcam_enabled: next,
                  webcam_src: next ? currentSrc : null,
                  webcam_dst: next ? currentDst : null,
                });
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '12px 16px',
                borderRadius: 8,
                border: edit.webcam_enabled ? '1px solid #C6FF3D' : '1px solid rgba(255,255,255,0.12)',
                background: edit.webcam_enabled ? 'rgba(198,255,61,0.15)' : '#171720',
                color: edit.webcam_enabled ? '#C6FF3D' : '#E8E8F0',
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {edit.webcam_enabled ? <Camera size={16} /> : <CameraOff size={16} />}
              {edit.webcam_enabled ? 'WEBCAM POPOUT AKTIF' : 'AKTIFKAN WEBCAM POPOUT'}
            </button>

            {edit.webcam_enabled && (
              <>
                {/* Source Frame Selector */}
                <div style={{ background: '#0B0B10', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#E8E8F0', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Crop size={13} style={{ color: '#C6FF3D' }} />
                    <span>Sorot Kamera di Video Asli:</span>
                  </div>

                  {/* Box Video Asli dengan Kotak Seleksi webcam_src */}
                  <div
                    ref={sourceFrameRef}
                    style={{
                      position: 'relative',
                      width: '100%',
                      aspectRatio: '16/9',
                      background: '#000',
                      borderRadius: 6,
                      overflow: 'hidden',
                      border: '1px solid rgba(255,255,255,0.15)',
                      userSelect: 'none',
                    }}
                  >
                    {isYoutubeMode ? (
                      <img
                        src={ytFrameUrl || `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`}
                        alt="YouTube Frame"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                      />
                    ) : (
                      <video
                        src={previewUrl || videoUrl || ''}
                        playsInline
                        style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
                      />
                    )}

                    {/* Kotak Seleksi webcam_src */}
                    <div
                      onMouseDown={(e) => handleSrcMouseDown(e)}
                      style={{
                        position: 'absolute',
                        left: `${currentSrc.x * 100}%`,
                        top: `${currentSrc.y * 100}%`,
                        width: `${currentSrc.w * 100}%`,
                        height: `${currentSrc.h * 100}%`,
                        border: '2px solid #C6FF3D',
                        background: 'rgba(198,255,61,0.25)',
                        cursor: draggingSrc ? 'grabbing' : 'grab',
                        boxShadow: '0 0 10px rgba(198,255,61,0.4)',
                        zIndex: 10,
                      }}
                    >
                      <div style={{ position: 'absolute', top: 2, left: 4, fontSize: 8, fontWeight: 900, color: '#0B0B10', background: '#C6FF3D', padding: '1px 3px', borderRadius: 2 }}>
                        CAM
                      </div>

                      {['nw', 'ne', 'se', 'sw'].map((h) => (
                        <div
                          key={h}
                          onMouseDown={(e) => handleSrcMouseDown(e, h)}
                          style={{
                            position: 'absolute',
                            width: 8,
                            height: 8,
                            background: '#C6FF3D',
                            border: '1px solid #0B0B10',
                            borderRadius: 1,
                            cursor: `${h}-resize`,
                            top: h.includes('n') ? -4 : 'auto',
                            bottom: h.includes('s') ? -4 : 'auto',
                            left: h.includes('w') ? -4 : 'auto',
                            right: h.includes('e') ? -4 : 'auto',
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  <div style={{ fontSize: 10, color: '#7A7A8A' }}>
                    Geser atau tarik sudut kotak kuning untuk memilih area kamera streamer.
                  </div>

                  {/* 4 Preset Pojok Cepat */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <button
                      onClick={() => applyWebcamSrcPreset('bottom_left')}
                      style={{ padding: '6px 8px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.1)', background: '#171720', color: '#E8E8F0', fontSize: 10, cursor: 'pointer' }}
                    >
                      Pojok Kiri Bawah
                    </button>
                    <button
                      onClick={() => applyWebcamSrcPreset('bottom_right')}
                      style={{ padding: '6px 8px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.1)', background: '#171720', color: '#E8E8F0', fontSize: 10, cursor: 'pointer' }}
                    >
                      Pojok Kanan Bawah
                    </button>
                    <button
                      onClick={() => applyWebcamSrcPreset('top_left')}
                      style={{ padding: '6px 8px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.1)', background: '#171720', color: '#E8E8F0', fontSize: 10, cursor: 'pointer' }}
                    >
                      Pojok Kiri Atas
                    </button>
                    <button
                      onClick={() => applyWebcamSrcPreset('top_right')}
                      style={{ padding: '6px 8px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.1)', background: '#171720', color: '#E8E8F0', fontSize: 10, cursor: 'pointer' }}
                    >
                      Pojok Kanan Atas
                    </button>
                  </div>
                </div>

                {/* Gaya Border & Corner Popout */}
                <div style={{ background: '#0B0B10', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#E8E8F0' }}>
                    Gaya Border &amp; Sudut Webcam
                  </span>

                  {/* Ketebalan Border */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#7A7A8A', marginBottom: 4 }}>
                      <span>KETEBALAN BORDER</span>
                      <span style={{ color: '#C6FF3D' }}>{edit.webcam_style?.border_px ?? 4}px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={20}
                      value={edit.webcam_style?.border_px ?? 4}
                      onChange={(e) =>
                        setEdit({
                          webcam_style: {
                            border_px: parseInt(e.target.value, 10),
                            border_color: edit.webcam_style?.border_color ?? '#FFFFFF',
                            radius_px: edit.webcam_style?.radius_px ?? 16,
                          },
                        })
                      }
                      style={{ width: '100%' }}
                    />
                  </div>

                  {/* Warna Border */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10, color: '#7A7A8A' }}>WARNA BORDER</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="color"
                        value={edit.webcam_style?.border_color ?? '#FFFFFF'}
                        onChange={(e) =>
                          setEdit({
                            webcam_style: {
                              border_px: edit.webcam_style?.border_px ?? 4,
                              border_color: e.target.value,
                              radius_px: edit.webcam_style?.radius_px ?? 16,
                            },
                          })
                        }
                        style={{ width: 22, height: 22, border: 'none', background: 'transparent', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#E8E8F0' }}>
                        {edit.webcam_style?.border_color ?? '#FFFFFF'}
                      </span>
                    </div>
                  </div>

                  {/* Radius Corner */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#7A7A8A', marginBottom: 4 }}>
                      <span>ROUNDED CORNER (SUDUT)</span>
                      <span style={{ color: '#C6FF3D' }}>{edit.webcam_style?.radius_px ?? 16}px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={160}
                      value={edit.webcam_style?.radius_px ?? 16}
                      onChange={(e) =>
                        setEdit({
                          webcam_style: {
                            border_px: edit.webcam_style?.border_px ?? 4,
                            border_color: edit.webcam_style?.border_color ?? '#FFFFFF',
                            radius_px: parseInt(e.target.value, 10),
                          },
                        })
                      }
                      style={{ width: '100%' }}
                    />
                  </div>

                  {/* Reset Posisi Popout ke Default */}
                  <button
                    onClick={() => {
                      setEdit({
                        webcam_dst: { x: 40, y: 80, w: 320, h: 320 },
                        webcam_src: { x: 0.02, y: 0.65, w: 0.28, h: 0.32 },
                      });
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '1px solid rgba(255,255,255,0.08)',
                      background: 'transparent',
                      color: '#7A7A8A',
                      fontSize: 10,
                      cursor: 'pointer',
                      marginTop: 4,
                    }}
                  >
                    <RotateCcw size={11} />
                    Reset Posisi &amp; Ukuran Webcam
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
