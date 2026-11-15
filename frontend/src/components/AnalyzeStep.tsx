import { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Play,
  Pause,
  AlertTriangle,
  ArrowRight,
  Plus,
  Scissors,
  CheckSquare,
  Square,
  Clock,
  Flame,
  Info,
  CheckCircle2,
  Film,
} from 'lucide-react';
import { useStore } from '../store';
import { analyzeClips } from '../api';
import type { ClipSegment } from '../types';

export default function AnalyzeStep() {
  const {
    youtubeUrl,
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

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [analyzedSrtSnapshot, setAnalyzedSrtSnapshot] = useState('');

  // Video preview player state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // Manual clip adjustment fields
  const [manualStart, setManualStart] = useState<number>(edit.clip_start);
  const [manualEnd, setManualEnd] = useState<number>(edit.clip_end ?? 30);

  // Sync manual inputs when edit state changes
  useEffect(() => {
    setManualStart(edit.clip_start);
    setManualEnd(edit.clip_end ?? (videoMeta?.duration ? Math.min(videoMeta.duration, edit.clip_start + 60) : 60));
  }, [edit.clip_start, edit.clip_end, videoMeta?.duration]);

  // Video time tracking
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const cur = videoRef.current.currentTime;
    setCurrentTime(cur);

    // Stop playback if reaches clip_end
    const end = edit.clip_end ?? videoMeta?.duration ?? 999999;
    if (cur >= end) {
      videoRef.current.pause();
      setIsPlaying(false);
      videoRef.current.currentTime = edit.clip_start;
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      if (videoRef.current.currentTime < edit.clip_start || videoRef.current.currentTime >= (edit.clip_end ?? 9999)) {
        videoRef.current.currentTime = edit.clip_start;
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
    if (videoRef.current) {
      videoRef.current.currentTime = c.start;
      videoRef.current.play();
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Banner Analisis & Info Model */}
      <div
        style={{
          background: '#12121A',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          padding: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 20,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 800, fontSize: 16, color: '#E8E8F0' }}>
              Analisis Potensi Klip Viral dengan Gemini AI
            </span>
            <span style={{ padding: '3px 8px', borderRadius: 4, background: 'rgba(198,255,61,0.15)', color: '#C6FF3D', fontSize: 11, fontWeight: 700 }}>
              Target Durasi Ideal: 30–65 detik
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#7A7A8A', display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.5 }}>
            <Info size={14} style={{ flexShrink: 0 }} />
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
            padding: '12px 24px',
            borderRadius: 8,
            border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 800,
            fontSize: 13,
            background: '#C6FF3D',
            color: '#0B0B10',
            letterSpacing: '0.04em',
            boxShadow: '0 0 20px rgba(198,255,61,0.25)',
            whiteSpace: 'nowrap',
          }}
        >
          <Sparkles size={16} />
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
            background: 'rgba(255,170,0,0.1)',
            border: '1px solid rgba(255,170,0,0.3)',
            borderRadius: 8,
            padding: '12px 18px',
            color: '#FFAA00',
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} />
            <span>Transkrip SRT telah diedit sejak analisis terakhir. Rekomendasi klip mungkin sudah basi.</span>
          </div>
          <button
            onClick={handleAnalyze}
            style={{
              background: '#FFAA00',
              color: '#0B0B10',
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
        <div style={{ background: 'rgba(255,90,54,0.1)', border: '1px solid #FF5A36', borderRadius: 8, padding: 12, color: '#FF5A36', fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Layout Grid: Pemutar Video Klip & Daftar Rekomendasi */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr', gap: 24, alignItems: 'start' }}>
        {/* Kolom Kiri: Player Preview Segmen & Timeline Pengatur Start/End */}
        <div
          style={{
            background: '#12121A',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 14, color: '#E8E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Preview Rentang Klip</span>
            <span style={{ fontSize: 11, color: '#C6FF3D', background: 'rgba(198,255,61,0.1)', padding: '2px 8px', borderRadius: 4 }}>
              {formatTime(currentTime)} / {formatTime(totalDuration)}
            </span>
          </div>

          {/* Video Player (jika video lokal tersedia) atau Placeholder */}
          <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
            {previewUrl || videoUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={previewUrl || videoUrl || ''}
                  onTimeUpdate={handleTimeUpdate}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
                <button
                  onClick={togglePlay}
                  style={{
                    position: 'absolute',
                    bottom: 12,
                    left: 12,
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: 'rgba(198,255,61,0.9)',
                    color: '#0B0B10',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  {isPlaying ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: 2 }} />}
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
                  color: '#7A7A8A',
                  padding: 20,
                  textAlign: 'center',
                }}
              >
                <Film size={36} style={{ color: '#C6FF3D', opacity: 0.8 }} />
                <div style={{ fontSize: 12, color: '#E8E8F0', fontWeight: 600 }}>Mode Cepat YouTube (Tanpa Download di Awal)</div>
                <div style={{ fontSize: 11 }}>Video utuh akan diunduh secara otomatis begitu kamu mengklik tombol "Lanjut Edit" di bawah.</div>
              </div>
            )}
          </div>

          {/* Timeline Visual & Scrubber Rentang Klip */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#7A7A8A', marginBottom: 8 }}>
              <span>Mulai: <strong style={{ color: '#E8E8F0' }}>{formatTime(edit.clip_start)}</strong></span>
              <span>Durasi Klip: <strong style={{ color: '#C6FF3D' }}>{((edit.clip_end ?? totalDuration) - edit.clip_start).toFixed(1)}s</strong></span>
              <span>Selesai: <strong style={{ color: '#E8E8F0' }}>{formatTime(edit.clip_end ?? totalDuration)}</strong></span>
            </div>

            {/* Bar Slider Rentang Klip */}
            <div style={{ position: 'relative', height: 24, background: '#0B0B10', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
              {/* Highlight area segmen */}
              <div
                style={{
                  position: 'absolute',
                  left: `${(edit.clip_start / totalDuration) * 100}%`,
                  width: `${(((edit.clip_end ?? totalDuration) - edit.clip_start) / totalDuration) * 100}%`,
                  height: '100%',
                  background: 'rgba(198,255,61,0.25)',
                  borderLeft: '2px solid #C6FF3D',
                  borderRight: '2px solid #C6FF3D',
                }}
              />
              {/* Marker Current Time */}
              <div
                style={{
                  position: 'absolute',
                  left: `${(currentTime / totalDuration) * 100}%`,
                  width: 2,
                  height: '100%',
                  background: '#FFFFFF',
                  zIndex: 2,
                }}
              />
            </div>
          </div>

          {/* Input Numeric untuk Start & End */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#7A7A8A', marginBottom: 4, fontWeight: 600 }}>
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
                  background: '#0B0B10',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  color: '#E8E8F0',
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#7A7A8A', marginBottom: 4, fontWeight: 600 }}>
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
                  background: '#0B0B10',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  color: '#E8E8F0',
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
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 800,
              fontSize: 12,
              background: '#C6FF3D',
              color: '#0B0B10',
              letterSpacing: '0.04em',
              marginTop: 10,
              boxShadow: '0 0 16px rgba(198,255,61,0.25)',
            }}
          >
            LANJUT KE EDIT ({markedClipIds.length > 0 ? `${markedClipIds.length} KLIP TERPILIH` : 'KLIP INI'})
            <ArrowRight size={15} />
          </button>
        </div>

        {/* Kolom Kanan: Multi-Clip Marking & Daftar Kandidat Klip AI */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Header & Aksi Multi-Clip */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 14, color: '#E8E8F0' }}>
                Kandidat Klip AI ({clips.length})
              </span>
              <span style={{ fontSize: 10, color: '#7A7A8A', background: '#12121A', padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.06)' }}>
                Target Durasi Ideal: 30–65 detik
              </span>
              {clips.length > 0 && (
                <span style={{ fontSize: 11, background: 'rgba(198,255,61,0.15)', color: '#C6FF3D', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
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
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: '1px solid rgba(255,255,255,0.12)',
                      background: 'transparent',
                      color: '#E8E8F0',
                      cursor: 'pointer',
                      fontSize: 11,
                      fontFamily: "'Montserrat', sans-serif",
                      fontWeight: 600,
                    }}
                  >
                    <CheckSquare size={12} />
                    Mark All
                  </button>
                  <button
                    onClick={unmarkAllClips}
                    title="Hapus semua tanda klip"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: '1px solid rgba(255,255,255,0.12)',
                      background: 'transparent',
                      color: '#7A7A8A',
                      cursor: 'pointer',
                      fontSize: 11,
                      fontFamily: "'Montserrat', sans-serif",
                      fontWeight: 600,
                    }}
                  >
                    <Square size={12} />
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
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'transparent',
                  color: '#E8E8F0',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 600,
                }}
              >
                <Plus size={13} />
                Tambah Manual
              </button>
            </div>
          </div>

          {clips.length === 0 && (
            <div
              style={{
                background: '#12121A',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
                padding: 40,
                textAlign: 'center',
                color: '#7A7A8A',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <Scissors size={32} style={{ opacity: 0.3 }} />
              <div style={{ fontSize: 13 }}>Belum ada segmen yang dianalisis.</div>
              <div style={{ fontSize: 11 }}>Klik tombol "Analisis Potensi Klip" di atas untuk meminta AI menemukan 5–10 segmen terbaik.</div>
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
                  background: isActive ? 'rgba(198,255,61,0.06)' : isMarked ? '#14141E' : '#0F0F15',
                  border: isActive
                    ? '1.5px solid #C6FF3D'
                    : isMarked
                    ? '1px solid rgba(198,255,61,0.3)'
                    : '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 10,
                  padding: 16,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  boxShadow: isActive ? '0 0 16px rgba(198,255,61,0.1)' : 'none',
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
                        background: isMarked ? '#C6FF3D' : 'rgba(255,255,255,0.08)',
                        color: isMarked ? '#0B0B10' : '#7A7A8A',
                        border: 'none',
                        borderRadius: 5,
                        width: 24,
                        height: 24,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                    >
                      {isMarked ? <CheckSquare size={15} /> : <Square size={15} />}
                    </button>

                    {/* Gauge Skor Viralitas */}
                    <div
                      style={{
                        padding: '4px 8px',
                        borderRadius: 6,
                        background:
                          clip.virality_score >= 85
                            ? 'rgba(198,255,61,0.2)'
                            : clip.virality_score >= 70
                            ? 'rgba(255,170,0,0.2)'
                            : 'rgba(255,255,255,0.08)',
                        color:
                          clip.virality_score >= 85
                            ? '#C6FF3D'
                            : clip.virality_score >= 70
                            ? '#FFAA00'
                            : '#E8E8F0',
                        fontFamily: "'Montserrat', sans-serif",
                        fontWeight: 900,
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Flame size={13} />
                      {clip.virality_score}
                    </div>

                    <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 13, color: '#E8E8F0' }}>
                      {clip.title}
                    </div>
                  </div>

                  <div style={{ fontSize: 11, color: '#7A7A8A', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={12} />
                    {clip.duration}s ({formatTime(clip.start)} - {formatTime(clip.end)})
                  </div>
                </div>

                <div style={{ fontSize: 12, color: '#7A7A8A', lineHeight: 1.5 }}>
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
                          fontSize: 10,
                          padding: '3px 8px',
                          borderRadius: 4,
                          background: 'rgba(255,255,255,0.05)',
                          color: '#C6FF3D',
                          border: '1px solid rgba(198,255,61,0.2)',
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
                  {previewUrl || videoUrl ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayClip(clip);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '5px 10px',
                        borderRadius: 6,
                        border: '1px solid rgba(255,255,255,0.12)',
                        background: 'transparent',
                        color: '#E8E8F0',
                        fontSize: 11,
                        cursor: 'pointer',
                        fontFamily: "'Montserrat', sans-serif",
                        fontWeight: 600,
                      }}
                    >
                      <Play size={11} />
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
                      padding: '5px 12px',
                      borderRadius: 6,
                      border: 'none',
                      background: isActive ? '#C6FF3D' : 'rgba(255,255,255,0.1)',
                      color: isActive ? '#0B0B10' : '#E8E8F0',
                      fontSize: 11,
                      cursor: 'pointer',
                      fontFamily: "'Montserrat', sans-serif",
                      fontWeight: 700,
                    }}
                  >
                    {isActive ? <CheckCircle2 size={12} /> : null}
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
