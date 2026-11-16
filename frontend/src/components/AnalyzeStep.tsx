import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import { useStore } from '../store';
import { analyzeClips } from '../api';
import type { ClipSegment } from '../types';

// Helper extract YouTube ID from diverse formats
function extractYoutubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /youtube\.com\/v\/([A-Za-z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = (url || '').match(p);
    if (m) return m[1];
  }
  return null;
}

export default function AnalyzeStep() {
  const {
    youtubeUrl,
    youtubeVideoId,
    edit,
    setEdit,
    videoMeta,
    videoUrl,
    previewUrl,
    clips,
    setClips,
    markedClipIds,
    toggleMarkClip,
    markAllClips,
    unmarkAllClips,
    activeClipId,
    setActiveClipId,
    setStep,
  } = useStore();

  const effectiveYoutubeId = youtubeVideoId || extractYoutubeId(youtubeUrl || edit.youtube_url || '');
  const videoSrc = previewUrl || videoUrl || (edit.video_filename ? `/files/uploads/${edit.video_filename}` : '');
  const isYoutube = !videoSrc && Boolean(effectiveYoutubeId);

  const selectedClip = clips.find((c) => (c.id || `clip_${c.start}_${c.end}`) === activeClipId) || clips[0] || null;
  const clipStart = selectedClip ? selectedClip.start : edit.clip_start;
  const clipEnd = selectedClip ? selectedClip.end : (edit.clip_end ?? (videoMeta?.duration || 300));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [analyzedSrtSnapshot, setAnalyzedSrtSnapshot] = useState('');

  // Video preview player state
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytIframeRef = useRef<HTMLIFrameElement>(null);
  const ytPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(clipStart || 0);

  // Manual clip adjustment fields
  const [manualStart, setManualStart] = useState<number>(edit.clip_start);
  const [manualEnd, setManualEnd] = useState<number>(edit.clip_end ?? 30);

  // Sync manual inputs when edit state changes
  useEffect(() => {
    setManualStart(edit.clip_start);
    setManualEnd(edit.clip_end ?? (videoMeta?.duration ? Math.min(videoMeta.duration, edit.clip_start + 60) : 60));
  }, [edit.clip_start, edit.clip_end, videoMeta?.duration]);

  const ytSendCmd = (func: string, args?: unknown[]) => {
    ytIframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args: args || [] }),
      '*'
    );
  };

  // Poll YouTube currentTime & auto pause at clipEnd
  useEffect(() => {
    if (!isYoutube) return;
    const handleMsg = (ev: MessageEvent) => {
      try {
        const data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
        if (data?.event === 'onReady') {
          ytSendCmd('seekTo', [clipStart, true]);
        }
        if (data?.event === 'infoDelivery' && data?.info?.currentTime !== undefined) {
          const cur = data.info.currentTime as number;
          setCurrentTime(cur);
          if (cur >= clipEnd) {
            ytSendCmd('pauseVideo');
            setIsPlaying(false);
            ytSendCmd('seekTo', [clipStart, true]);
          }
        }
      } catch { /* ignore */ }
    };
    window.addEventListener('message', handleMsg);
    ytPollRef.current = setInterval(() => {
      ytIframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening' }), '*'
      );
    }, 250);
    return () => {
      window.removeEventListener('message', handleMsg);
      if (ytPollRef.current) clearInterval(ytPollRef.current);
    };
  }, [isYoutube, clipStart, clipEnd]);

  // Auto seek saat clipStart berubah
  useEffect(() => {
    setCurrentTime(clipStart);
    if (videoSrc && videoRef.current) {
      videoRef.current.currentTime = clipStart;
    } else if (isYoutube) {
      ytSendCmd('seekTo', [clipStart, true]);
    }
  }, [clipStart, videoSrc, isYoutube]);

  // Video time tracking (Video Lokal)
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const cur = videoRef.current.currentTime;
    setCurrentTime(cur);

    // Stop playback if reaches clipEnd
    if (cur >= clipEnd) {
      videoRef.current.pause();
      setIsPlaying(false);
      videoRef.current.currentTime = clipStart;
      setCurrentTime(clipStart);
    }
  };

  const togglePlay = () => {
    if (isYoutube) {
      if (isPlaying) {
        ytSendCmd('pauseVideo');
        setIsPlaying(false);
      } else {
        if (currentTime < clipStart || currentTime >= clipEnd) {
          ytSendCmd('seekTo', [clipStart, true]);
        }
        ytSendCmd('playVideo');
        setIsPlaying(true);
      }
      return;
    }
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      if (videoRef.current.currentTime < clipStart || videoRef.current.currentTime >= clipEnd) {
        videoRef.current.currentTime = clipStart;
      }
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handlePlayClip = (c: ClipSegment) => {
    const clipId = c.id || `clip_${c.start}_${c.end}`;
    setActiveClipId(clipId);
    setEdit({
      clip_start: c.start,
      clip_end: c.end,
      hook_text: c.suggested_hooks?.[0] || edit.hook_text,
    });
    setCurrentTime(c.start);
    if (videoSrc && videoRef.current) {
      videoRef.current.currentTime = c.start;
      videoRef.current.play();
      setIsPlaying(true);
    } else if (isYoutube) {
      ytSendCmd('seekTo', [c.start, true]);
      ytSendCmd('playVideo');
      setIsPlaying(true);
    }
  };

  const handleSelectClip = (c: ClipSegment) => {
    const clipId = c.id || `clip_${c.start}_${c.end}`;
    setActiveClipId(clipId);
    setEdit({
      clip_start: c.start,
      clip_end: c.end,
      hook_text: c.suggested_hooks?.[0] || edit.hook_text,
    });
    setCurrentTime(c.start);
    if (videoSrc && videoRef.current) {
      videoRef.current.currentTime = c.start;
    } else if (isYoutube) {
      ytSendCmd('seekTo', [c.start, true]);
    }
  };

  // Handler: Jalankan Analisis AI
  const handleAnalyze = async () => {
    if (!edit.srt_text.trim()) {
      setError('Subtitle SRT masih kosong. Isi atau upload SRT di Tahap 1 terlebih dahulu.');
      return;
    }
    const duration = videoMeta?.duration || 300;
    setLoading(true);
    setError('');

    try {
      const res = await analyzeClips(edit.srt_text, duration, 'Indonesian');
      setClips(res.clips);
      setAnalyzedSrtSnapshot(edit.srt_text);

      if (res.clips.length > 0) {
        const top = res.clips[0];
        const topId = top.id || `clip_0_${top.start}_${top.end}`;
        setActiveClipId(topId);
        setEdit({
          clip_start: top.start,
          clip_end: top.end,
          hook_text: top.suggested_hooks?.[0] || '',
        });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // Handler: Tambah Segmen Manual
  const handleAddManualSegment = () => {
    const s = Math.max(0, edit.clip_start);
    const e = Math.min(videoMeta?.duration || 300, s + 45);
    const id = `manual_${Date.now()}`;
    const newSeg: ClipSegment = {
      id,
      start: s,
      end: e,
      duration: e - s,
      title: `Segmen Manual (${formatTime(s)} - ${formatTime(e)})`,
      virality_score: 75,
      reason: 'Segmen yang kamu tambahkan secara manual.',
      suggested_hooks: [],
    };
    const nextClips = [newSeg, ...clips];
    setClips(nextClips);
    setActiveClipId(id);
    setEdit({ clip_start: s, clip_end: e });
  };

  // Handler: Pindah ke Tahap Edit (Mode Online YouTube: tanpa download video di awal)
  const handleProceedToEdit = () => {
    // Pastikan minimal ada 1 klip yang di-mark
    if (markedClipIds.length === 0 && clips.length > 0) {
      markAllClips();
    }
    if (youtubeUrl) {
      setEdit({ youtube_url: youtubeUrl });
    }
    // Langsung lanjut ke Tahap 3
    setStep(3);
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  const parseInputTime = (str: string): number => {
    if (str.includes(':')) {
      const [m, s] = str.split(':');
      return (parseFloat(m) || 0) * 60 + (parseFloat(s) || 0);
    }
    return parseFloat(str) || 0;
  };

  const isSrtModified = analyzedSrtSnapshot && analyzedSrtSnapshot !== edit.srt_text;
  const totalDuration = videoMeta?.duration || 300;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      {/* Banner Analisis & Info Model */}
      <div
        style={{
          background: '#F6F4F1',
          border: '1px solid #D3D9D6',
          borderRadius: 16,
          padding: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 20,
          boxShadow: '0 1px 3px rgba(17,25,22,0.04)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 800, fontSize: 16, color: '#111916' }}>
              Analisis Potensi Klip Viral dengan Gemini AI
            </span>
            <span style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(29, 99, 78, 0.12)', color: '#1D634E', fontSize: 11, fontWeight: 700 }}>
              Target Durasi Ideal: 30–65 detik
            </span>
          </div>
          <div style={{ fontSize: 13, color: '#5A635F', display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.5 }}>
            <Icon icon="solar:info-circle-bold-duotone" width={16} height={16} style={{ flexShrink: 0, color: '#1D634E' }} />
            AI menganalisis struktur kalimat transkrip SRT untuk menemukan gagasan utuh, punchline, dan hook terbaik tanpa menunggu download video.
          </div>
        </div>

        <button
          onClick={handleAnalyze}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 26px',
            borderRadius: 10,
            border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 800,
            fontSize: 13,
            background: '#1D634E',
            color: '#F6F4F1',
            letterSpacing: '0.04em',
            boxShadow: '0 2px 10px rgba(29, 99, 78, 0.25)',
            whiteSpace: 'nowrap',
            transition: 'all 0.15s ease',
          }}
        >
          {loading ? (
            <Icon icon="solar:refresh-circle-bold-duotone" width={18} height={18} className="animate-spin" />
          ) : (
            <Icon icon="solar:magic-stick-3-bold-duotone" width={18} height={18} />
          )}
          {loading ? 'MENGANALISIS TRANSKRIP...' : clips.length > 0 ? 'ANALISIS ULANG' : 'ANALISIS POTENSI KLIP'}
        </button>
      </div>

      {/* Peringatan jika SRT diubah setelah analisis */}
      {isSrtModified && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(202, 138, 4, 0.1)',
            border: '1px solid rgba(202, 138, 4, 0.3)',
            borderRadius: 10,
            padding: '12px 18px',
            color: '#CA8A04',
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon icon="solar:danger-triangle-bold-duotone" width={18} height={18} />
            <span>Transkrip SRT telah diedit sejak analisis terakhir. Rekomendasi klip mungkin sudah basi.</span>
          </div>
          <button
            onClick={handleAnalyze}
            style={{
              background: '#CA8A04',
              color: '#F6F4F1',
              border: 'none',
              borderRadius: 6,
              padding: '6px 14px',
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 700,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Analisis Ulang
          </button>
        </div>
      )}

      {error && (
        <div style={{ background: 'rgba(181, 67, 41, 0.08)', border: '1px solid #B54329', borderRadius: 10, padding: 14, color: '#B54329', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Layout Grid: Pemutar Video Klip & Daftar Rekomendasi */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr', gap: 24, alignItems: 'start' }}>
        {/* Kolom Kiri: Player Preview Segmen & Timeline Pengatur Start/End */}
        <div
          style={{
            background: '#F6F4F1',
            border: '1px solid #D3D9D6',
            borderRadius: 16,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            boxShadow: '0 1px 3px rgba(17,25,22,0.04)',
          }}
        >
          <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 14, color: '#111916', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Preview Rentang Klip</span>
            <span style={{ fontSize: 11, color: '#1D634E', background: 'rgba(29, 99, 78, 0.12)', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
              {formatTime(currentTime)} / {formatTime(totalDuration)}
            </span>
          </div>

          {/* Video Player (jika video lokal tersedia) atau YouTube IFrame - KEPT DARK */}
          <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000000', borderRadius: 10, overflow: 'hidden' }}>
            {videoSrc ? (
              <>
                <video
                  ref={videoRef}
                  src={videoSrc}
                  onLoadedMetadata={() => {
                    if (videoRef.current) {
                      videoRef.current.currentTime = clipStart;
                      setCurrentTime(clipStart);
                    }
                  }}
                  onTimeUpdate={handleTimeUpdate}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
                <button
                  onClick={togglePlay}
                  style={{
                    position: 'absolute',
                    bottom: 12,
                    left: 12,
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background: '#1D634E',
                    color: '#F6F4F1',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    zIndex: 10,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                  }}
                >
                  <Icon icon={isPlaying ? 'solar:pause-bold-duotone' : 'solar:play-bold-duotone'} width={18} height={18} />
                </button>
              </>
            ) : isYoutube ? (
              <>
                <iframe
                  ref={ytIframeRef}
                  src={`https://www.youtube.com/embed/${effectiveYoutubeId}?enablejsapi=1&rel=0&modestbranding=1&start=${Math.floor(clipStart)}`}
                  allow="autoplay; encrypted-media"
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  title="YouTube Preview"
                />
                <button
                  onClick={togglePlay}
                  style={{
                    position: 'absolute',
                    bottom: 12,
                    left: 12,
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background: '#1D634E',
                    color: '#F6F4F1',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    zIndex: 10,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                  }}
                >
                  <Icon icon={isPlaying ? 'solar:pause-bold-duotone' : 'solar:play-bold-duotone'} width={18} height={18} />
                </button>
              </>
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  color: '#5A635F',
                  padding: 20,
                  textAlign: 'center',
                }}
              >
                <Icon icon="solar:videocamera-record-bold-duotone" width={36} height={36} style={{ color: '#1D634E' }} />
                <div style={{ fontSize: 13, color: '#F6F4F1', fontWeight: 600 }}>Belum Ada Sumber Video</div>
                <div style={{ fontSize: 11 }}>Silakan masukkan URL YouTube atau upload file video di Tahap 1.</div>
              </div>
            )}
          </div>

          {/* Timeline Visual & Scrubber Rentang Klip */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#5A635F', marginBottom: 8 }}>
              <span>Mulai: <strong style={{ color: '#111916' }}>{formatTime(edit.clip_start)}</strong></span>
              <span>Durasi Klip: <strong style={{ color: '#1D634E' }}>{((edit.clip_end ?? totalDuration) - edit.clip_start).toFixed(1)}s</strong></span>
              <span>Selesai: <strong style={{ color: '#111916' }}>{formatTime(edit.clip_end ?? totalDuration)}</strong></span>
            </div>

            {/* Bar Slider Rentang Klip */}
            <div style={{ position: 'relative', height: 24, background: '#EFF2F0', borderRadius: 8, overflow: 'hidden', border: '1px solid #D3D9D6' }}>
              {/* Highlight area segmen */}
              <div
                style={{
                  position: 'absolute',
                  left: `${(edit.clip_start / totalDuration) * 100}%`,
                  width: `${(((edit.clip_end ?? totalDuration) - edit.clip_start) / totalDuration) * 100}%`,
                  height: '100%',
                  background: 'rgba(29, 99, 78, 0.25)',
                  borderLeft: '2px solid #1D634E',
                  borderRight: '2px solid #1D634E',
                }}
              />
              {/* Marker Current Time */}
              <div
                style={{
                  position: 'absolute',
                  left: `${(currentTime / totalDuration) * 100}%`,
                  width: 2,
                  height: '100%',
                  background: '#111916',
                  zIndex: 2,
                }}
              />
            </div>
          </div>

          {/* Input Numeric untuk Start & End */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#5A635F', marginBottom: 4, fontWeight: 700 }}>
                WAKTU MULAI (mm:ss.s / detik)
              </label>
              <input
                type="text"
                value={formatTime(manualStart)}
                onChange={(e) => {
                  const val = parseInputTime(e.target.value);
                  setManualStart(val);
                  setEdit({ clip_start: val });
                }}
                style={{
                  width: '100%',
                  background: '#EFF2F0',
                  border: '1px solid #D3D9D6',
                  borderRadius: 8,
                  padding: '8px 10px',
                  color: '#111916',
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#5A635F', marginBottom: 4, fontWeight: 700 }}>
                WAKTU SELESAI (mm:ss.s / detik)
              </label>
              <input
                type="text"
                value={formatTime(manualEnd)}
                onChange={(e) => {
                  const val = parseInputTime(e.target.value);
                  setManualEnd(val);
                  setEdit({ clip_end: val });
                }}
                style={{
                  width: '100%',
                  background: '#EFF2F0',
                  border: '1px solid #D3D9D6',
                  borderRadius: 8,
                  padding: '8px 10px',
                  color: '#111916',
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Tombol Lanjut ke Edit */}
          <button
            onClick={handleProceedToEdit}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 20px',
              borderRadius: 10,
              border: 'none',
              cursor: 'pointer',
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 800,
              fontSize: 12,
              background: '#1D634E',
              color: '#F6F4F1',
              letterSpacing: '0.04em',
              marginTop: 10,
              boxShadow: '0 2px 10px rgba(29, 99, 78, 0.25)',
              transition: 'all 0.15s ease',
            }}
          >
            LANJUT KE EDIT ({markedClipIds.length > 0 ? `${markedClipIds.length} KLIP TERPILIH` : 'KLIP INI'})
            <Icon icon="solar:arrow-right-bold-duotone" width={16} height={16} />
          </button>
        </div>

        {/* Kolom Kanan: Multi-Clip Marking & Daftar Kandidat Klip AI */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Header & Aksi Multi-Clip */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 14, color: '#111916' }}>
                Kandidat Klip AI ({clips.length})
              </span>
              <span style={{ fontSize: 10, color: '#5A635F', background: '#EFF2F0', padding: '3px 8px', borderRadius: 4, border: '1px solid #D3D9D6' }}>
                Target Durasi Ideal: 30–65 detik
              </span>
              {clips.length > 0 && (
                <span style={{ fontSize: 11, background: 'rgba(29, 99, 78, 0.12)', color: '#1D634E', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
                  {markedClipIds.length} Ditandai
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {clips.length > 0 && (
                <>
                  <button
                    onClick={markAllClips}
                    title="Tandai semua klip untuk diedit bersama"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: '1px solid #D3D9D6',
                      background: '#EFF2F0',
                      color: '#111916',
                      cursor: 'pointer',
                      fontSize: 11,
                      fontFamily: "'Montserrat', sans-serif",
                      fontWeight: 600,
                    }}
                  >
                    <Icon icon="solar:check-square-bold-duotone" width={14} height={14} />
                    Mark All
                  </button>
                  <button
                    onClick={unmarkAllClips}
                    title="Hapus semua tanda klip"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: '1px solid #D3D9D6',
                      background: '#EFF2F0',
                      color: '#5A635F',
                      cursor: 'pointer',
                      fontSize: 11,
                      fontFamily: "'Montserrat', sans-serif",
                      fontWeight: 600,
                    }}
                  >
                    <Icon icon="solar:square-bold-duotone" width={14} height={14} />
                    Unmark All
                  </button>
                </>
              )}

              <button
                onClick={handleAddManualSegment}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: '1px solid #D3D9D6',
                  background: '#EFF2F0',
                  color: '#111916',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 600,
                }}
              >
                <Icon icon="solar:add-circle-bold-duotone" width={14} height={14} />
                Tambah Manual
              </button>
            </div>
          </div>

          {clips.length === 0 && (
            <div
              style={{
                background: '#F6F4F1',
                border: '1px solid #D3D9D6',
                borderRadius: 16,
                padding: 40,
                textAlign: 'center',
                color: '#5A635F',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <Icon icon="solar:scissors-bold-duotone" width={36} height={36} style={{ color: '#1D634E', opacity: 0.4 }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111916' }}>Belum ada segmen yang dianalisis.</div>
              <div style={{ fontSize: 12 }}>Klik tombol "Analisis Potensi Klip" di atas untuk meminta AI menemukan 5–10 segmen terbaik.</div>
            </div>
          )}

          {clips.map((clip, idx) => {
            const clipId = clip.id || `clip_${idx}_${Math.round(clip.start)}_${Math.round(clip.end)}`;
            const isMarked = markedClipIds.includes(clipId);
            const isActive = activeClipId === clipId;

            return (
              <div
                key={clipId}
                onClick={() => handleSelectClip(clip)}
                style={{
                  background: isActive ? 'rgba(29, 99, 78, 0.08)' : isMarked ? '#EFF2F0' : '#F6F4F1',
                  border: isActive
                    ? '1.5px solid #1D634E'
                    : isMarked
                    ? '1px solid #1D634E'
                    : '1px solid #D3D9D6',
                  borderRadius: 12,
                  padding: 16,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  boxShadow: isActive ? '0 2px 8px rgba(29, 99, 78, 0.12)' : '0 1px 2px rgba(17,25,22,0.03)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {/* Checkbox / Toggle Mark */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMarkClip(clipId);
                      }}
                      title={isMarked ? 'Hapus tanda klip' : 'Tandai klip ini untuk diedit'}
                      style={{
                        background: isMarked ? '#1D634E' : '#EFF2F0',
                        color: isMarked ? '#F6F4F1' : '#5A635F',
                        border: '1px solid #D3D9D6',
                        borderRadius: 6,
                        width: 26,
                        height: 26,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                    >
                      <Icon icon={isMarked ? 'solar:check-square-bold-duotone' : 'solar:square-bold-duotone'} width={16} height={16} />
                    </button>

                    {/* Gauge Skor Viralitas */}
                    <div
                      style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        background:
                          clip.virality_score >= 85
                            ? 'rgba(29, 99, 78, 0.15)'
                            : clip.virality_score >= 70
                            ? 'rgba(202, 138, 4, 0.15)'
                            : '#EFF2F0',
                        color:
                          clip.virality_score >= 85
                            ? '#1D634E'
                            : clip.virality_score >= 70
                            ? '#CA8A04'
                            : '#5A635F',
                        fontFamily: "'Montserrat', sans-serif",
                        fontWeight: 900,
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Icon icon="solar:fire-bold-duotone" width={14} height={14} />
                      {clip.virality_score}
                    </div>

                    <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 13, color: '#111916' }}>
                      {clip.title}
                    </div>
                  </div>

                  <div style={{ fontSize: 11, color: '#5A635F', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Icon icon="solar:clock-circle-bold-duotone" width={14} height={14} />
                    {clip.duration}s ({formatTime(clip.start)} - {formatTime(clip.end)})
                  </div>
                </div>

                <div style={{ fontSize: 12, color: '#5A635F', lineHeight: 1.5 }}>
                  {clip.reason}
                </div>

                {/* Rekomendasi Hook AI jika ada */}
                {clip.suggested_hooks && clip.suggested_hooks.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                    {clip.suggested_hooks.map((h, i) => (
                      <span
                        key={i}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEdit({ hook_text: h });
                        }}
                        style={{
                          fontSize: 11,
                          padding: '3px 8px',
                          borderRadius: 6,
                          background: '#EFF2F0',
                          color: '#1D634E',
                          border: '1px solid rgba(29, 99, 78, 0.25)',
                          cursor: 'pointer',
                        }}
                      >
                        Hook: "{h}"
                      </span>
                    ))}
                  </div>
                )}

                {/* Action Buttons Bar */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                  {(videoSrc || isYoutube) ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayClip(clip);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: '1px solid #D3D9D6',
                        background: '#EFF2F0',
                        color: '#111916',
                        fontSize: 11,
                        cursor: 'pointer',
                        fontFamily: "'Montserrat', sans-serif",
                        fontWeight: 600,
                      }}
                    >
                      <Icon icon="solar:play-bold-duotone" width={13} height={13} />
                      Putar Segmen
                    </button>
                  ) : null}

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectClip(clip);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '6px 14px',
                      borderRadius: 6,
                      border: 'none',
                      background: isActive ? '#1D634E' : '#EFF2F0',
                      color: isActive ? '#F6F4F1' : '#111916',
                      fontSize: 11,
                      cursor: 'pointer',
                      fontFamily: "'Montserrat', sans-serif",
                      fontWeight: 700,
                    }}
                  >
                    {isActive && <Icon icon="solar:check-circle-bold-duotone" width={14} height={14} />}
                    {isActive ? 'Aktif Diedit' : 'Pilih Klip'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
