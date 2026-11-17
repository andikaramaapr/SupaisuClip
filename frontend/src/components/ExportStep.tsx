import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import { useStore } from '../store';
import {
  fetchEncoders,
  startRender,
  pollRenderStatus,
  generateMetadata,
} from '../api';

export default function ExportStep() {
  const { edit, setEdit, videoMeta, videoUrl, previewUrl, setRenderJobId, youtubeVideoId } = useStore();

  // Encoder info dari backend
  const [encoders, setEncoders] = useState<{ available: string[]; recommended: string; threads: number }>({
    available: ['libx264'],
    recommended: 'libx264',
    threads: 4,
  });

  // Render Job State
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderEta, setRenderEta] = useState<number | null>(null);
  const [renderError, setRenderError] = useState('');
  const [exportUrl, setExportUrl] = useState('');
  const [exportFilename, setExportFilename] = useState('');
  const [usedEncoder, setUsedEncoder] = useState('');
  const renderPollRef = useRef<number | null>(null);

  // Riwayat Render Sesi Ini
  const [renderHistory, setRenderHistory] = useState<Array<{ filename: string; url: string; time: string }>>([]);

  // AI Metadata State
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [metaResult, setMetaResult] = useState<{ title: string; description: string; hashtags: string[] } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Load encoder options on mount
  useEffect(() => {
    fetchEncoders()
      .then((res) => {
        setEncoders(res);
        if (edit.encoder === 'auto') {
          setEdit({ encoder: res.recommended });
        }
      })
      .catch(() => {});
  }, []);

  // Bersihkan polling saat unmount
  useEffect(() => {
    return () => {
      if (renderPollRef.current) clearInterval(renderPollRef.current);
    };
  }, []);

  // Jalankan Render (Klip Penuh atau Preview 5 Detik)
  const handleStartRender = async (previewOnly = false) => {
    setRendering(true);
    setRenderProgress(0);
    setRenderEta(null);
    setRenderError('');
    setExportUrl('');

    // Pastikan style_key tidak kosong atau ter-reset menjadi "NONE"
    const rawStyle = edit.style_key;
    const effectiveStyle =
      !rawStyle || rawStyle.trim() === '' || rawStyle.toLowerCase() === 'none'
        ? 'viral_pop'
        : rawStyle;

    const payload = {
      ...edit,
      style_key: effectiveStyle,
      subtitle_margin_v: edit.subtitle_margin_v ?? 340,
      srt_relative: false,          // selalu kirim sebagai absolut; backend yang normalkan
      preview_seconds: previewOnly ? 5 : null,
    };

    try {
      const { job_id } = await startRender(payload);
      setRenderJobId(job_id);

      renderPollRef.current = window.setInterval(async () => {
        try {
          const st = await pollRenderStatus(job_id);
          if (st.status === 'running' || st.status === 'queued') {
            setRenderProgress(st.progress ?? 0);
            setRenderEta(st.eta_sec ?? null);
          } else if (st.status === 'done') {
            if (renderPollRef.current) clearInterval(renderPollRef.current);
            setRendering(false);
            setRenderProgress(100);
            setExportUrl(st.export_url || '');
            setExportFilename(st.export_filename || 'supaisu_clip.mp4');
            setUsedEncoder(st.encoder || edit.encoder);

            if (st.export_url) {
              setRenderHistory((prev) => [
                {
                  filename: st.export_filename || 'clip.mp4',
                  url: st.export_url || '',
                  time: new Date().toLocaleTimeString(),
                },
                ...prev,
              ]);
            }
          } else if (st.status === 'error') {
            if (renderPollRef.current) clearInterval(renderPollRef.current);
            setRendering(false);
            setRenderError(st.error || 'Proses render gagal.');
          }
        } catch (e: unknown) {
          if (renderPollRef.current) clearInterval(renderPollRef.current);
          setRendering(false);
          setRenderError(e instanceof Error ? e.message : String(e));
        }
      }, 1000);
    } catch (e: unknown) {
      setRendering(false);
      setRenderError(e instanceof Error ? e.message : String(e));
    }
  };

  // Generate Metadata Medsos
  const handleGenerateMetadata = async () => {
    if (!edit.srt_text.trim()) return;
    setLoadingMeta(true);
    try {
      const res = await generateMetadata(edit.srt_text, 'TikTok', 'Indonesian', edit.clip_start, edit.clip_end);
      setMetaResult(res);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMeta(false);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const clipDuration = ((edit.clip_end ?? videoMeta?.duration ?? 60) - edit.clip_start).toFixed(1);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.6fr', gap: 24, alignItems: 'start', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      {/* Kolom Kiri: Player Hasil Render & Final Preview */}
      <div
        style={{
          background: '#F6F4F1',
          border: '1px solid #D3D9D6',
          borderRadius: 16,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          boxShadow: '0 1px 3px rgba(17,25,22,0.04)',
        }}
      >
        <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 15, color: '#111916', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Hasil Render / Preview 9:16</span>
          <span style={{ fontSize: 11, color: '#1D634E', background: 'rgba(29, 99, 78, 0.12)', padding: '3px 8px', borderRadius: 4, fontWeight: 700 }}>
            Durasi: {clipDuration}s · {edit.resolution}p
          </span>
        </div>

        {/* Video Player */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: 340,
            margin: '0 auto',
            aspectRatio: '9/16',
            background: '#000000',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
            border: '1px solid #D3D9D6',
          }}
        >
          {exportUrl ? (
            <video
              src={exportUrl}
              controls
              autoPlay
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : !videoUrl && youtubeVideoId ? (
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              <iframe
                src={`https://www.youtube.com/embed/${youtubeVideoId}?enablejsapi=1&controls=1&modestbranding=1&rel=0&start=${Math.floor(edit.clip_start)}`}
                allow="autoplay; encrypted-media"
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="YouTube Preview"
              />
              <div
                style={{
                  position: 'absolute',
                  top: 10,
                  left: 10,
                  background: 'rgba(17,25,22,0.85)',
                  padding: '4px 8px',
                  borderRadius: 4,
                  fontSize: 10,
                  color: '#F6F4F1',
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 700,
                  border: '1px solid #D3D9D6',
                }}
              >
                ONLINE YOUTUBE PREVIEW
              </div>
            </div>
          ) : (
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              <video
                src={previewUrl || videoUrl || ''}
                controls
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: edit.layout_mode === 'blur_bg' ? 'contain' : 'cover',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: 10,
                  left: 10,
                  background: 'rgba(17,25,22,0.85)',
                  padding: '4px 8px',
                  borderRadius: 4,
                  fontSize: 10,
                  color: '#1D634E',
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 700,
                }}
              >
                LIVE CANVAS PREVIEW
              </div>
            </div>
          )}
        </div>

        {/* Tombol Download jika hasil export ada */}
        {exportUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <a
              href={exportUrl}
              download={exportFilename}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '12px 20px',
                borderRadius: 10,
                background: '#1D634E',
                color: '#F6F4F1',
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 800,
                fontSize: 13,
                textDecoration: 'none',
                letterSpacing: '0.04em',
                boxShadow: '0 2px 10px rgba(29, 99, 78, 0.3)',
              }}
            >
              <Icon icon="solar:download-minimalistic-bold-duotone" width={18} height={18} />
              DOWNLOAD VIDEO MP4
            </a>
            <div style={{ fontSize: 11, color: '#5A635F', textAlign: 'center' }}>
              Dirender dengan encoder: <strong style={{ color: '#111916' }}>{usedEncoder}</strong>
            </div>
          </div>
        )}

        {/* Riwayat Render Sesi Ini */}
        {renderHistory.length > 0 && (
          <div style={{ marginTop: 10, borderTop: '1px solid #D3D9D6', paddingTop: 12 }}>
            <div style={{ fontSize: 11, fontFamily: "'Montserrat', sans-serif", fontWeight: 700, color: '#5A635F', marginBottom: 8 }}>
              RIWAYAT RENDER SESI INI ({renderHistory.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 120, overflowY: 'auto' }}>
              {renderHistory.map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: '#EFF2F0',
                    fontSize: 11,
                    border: '1px solid #D3D9D6',
                  }}
                >
                  <span className="truncate" style={{ color: '#111916', maxWidth: 180 }}>{item.filename}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#5A635F', fontSize: 10 }}>{item.time}</span>
                    <a href={item.url} download={item.filename} style={{ color: '#1D634E' }}>
                      <Icon icon="solar:download-minimalistic-bold-duotone" width={14} height={14} />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Kolom Kanan: Pengaturan Render, Action Buttons & AI Metadata */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Panel Pengaturan Render */}
        <div
          style={{
            background: '#F6F4F1',
            border: '1px solid #D3D9D6',
            borderRadius: 16,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            boxShadow: '0 1px 3px rgba(17,25,22,0.04)',
          }}
        >
          <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 14, color: '#111916', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon icon="solar:settings-bold-duotone" width={18} height={18} style={{ color: '#1D634E' }} />
            PENGATURAN EXPORT FFmpeg
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {/* Resolusi */}
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#5A635F', marginBottom: 4, fontWeight: 700 }}>
                RESOLUSI VERTICAL
              </label>
              <select
                value={edit.resolution}
                onChange={(e) => setEdit({ resolution: parseInt(e.target.value, 10) as 1080 | 720 })}
                style={{
                  width: '100%',
                  background: '#EFF2F0',
                  border: '1px solid #D3D9D6',
                  borderRadius: 8,
                  color: '#111916',
                  padding: '8px 10px',
                  fontSize: 12,
                  outline: 'none',
                }}
              >
                <option value={1080}>1080p (1080x1920) · Standar Reels/TikTok</option>
                <option value={720}>720p (720x1280) · Lebih Cepat</option>
              </select>
            </div>

            {/* Hardware Encoder */}
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#5A635F', marginBottom: 4, fontWeight: 700 }}>
                ENCODER VIDEO
              </label>
              <select
                value={edit.encoder}
                onChange={(e) => setEdit({ encoder: e.target.value })}
                style={{
                  width: '100%',
                  background: '#EFF2F0',
                  border: '1px solid #D3D9D6',
                  borderRadius: 8,
                  color: '#111916',
                  padding: '8px 10px',
                  fontSize: 12,
                  outline: 'none',
                }}
              >
                <option value="auto">Auto (Rekomendasi: {encoders.recommended})</option>
                {encoders.available.map((enc) => (
                  <option key={enc} value={enc}>
                    {enc} {enc === encoders.recommended ? '🌟 (Optimal)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {/* CRF Kualitas */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#5A635F', marginBottom: 4 }}>
                <span>KUALITAS (CRF)</span>
                <span style={{ color: '#1D634E', fontWeight: 700 }}>{edit.crf} (Semakin kecil semakin tajam)</span>
              </div>
              <input
                type="range"
                min={16}
                max={30}
                step={1}
                value={edit.crf}
                onChange={(e) => setEdit({ crf: parseInt(e.target.value, 10) })}
                style={{ width: '100%' }}
              />
            </div>

            {/* FPS */}
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#5A635F', marginBottom: 4, fontWeight: 700 }}>
                FRAME RATE (FPS)
              </label>
              <select
                value={edit.fps ?? ''}
                onChange={(e) => setEdit({ fps: e.target.value ? parseInt(e.target.value, 10) : null })}
                style={{
                  width: '100%',
                  background: '#EFF2F0',
                  border: '1px solid #D3D9D6',
                  borderRadius: 8,
                  color: '#111916',
                  padding: '8px 10px',
                  fontSize: 12,
                  outline: 'none',
                }}
              >
                <option value="">Auto (Sama dengan video asli)</option>
                <option value={30}>30 FPS</option>
                <option value={60}>60 FPS</option>
              </select>
            </div>
          </div>

          {/* Action Buttons: Render Preview 5 Detik & Render Penuh */}
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button
              onClick={() => handleStartRender(true)}
              disabled={rendering}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '12px 14px',
                borderRadius: 10,
                border: '1px solid #D3D9D6',
                background: '#EFF2F0',
                color: '#111916',
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 700,
                fontSize: 11,
                cursor: rendering ? 'not-allowed' : 'pointer',
              }}
            >
              <Icon icon="solar:videocamera-record-bold-duotone" width={16} height={16} />
              Render Cepat 5 Detik
            </button>

            <button
              onClick={() => handleStartRender(false)}
              disabled={rendering}
              style={{
                flex: 1.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '12px 20px',
                borderRadius: 10,
                border: 'none',
                background: '#1D634E',
                color: '#F6F4F1',
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 800,
                fontSize: 13,
                cursor: rendering ? 'not-allowed' : 'pointer',
                letterSpacing: '0.04em',
                boxShadow: '0 2px 12px rgba(29, 99, 78, 0.3)',
              }}
            >
              {rendering ? (
                <Icon icon="solar:refresh-circle-bold-duotone" width={18} height={18} className="animate-spin" />
              ) : (
                <Icon icon="solar:videocamera-record-bold-duotone" width={18} height={18} />
              )}
              {rendering ? 'SEDANG MERENDER...' : `RENDER KLIP ${edit.resolution}P`}
            </button>
          </div>

          {/* Indikator Progres Render Nyata */}
          {rendering && (
            <div style={{ marginTop: 8, background: '#EFF2F0', padding: 12, borderRadius: 8, border: '1px solid #D3D9D6' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#5A635F', marginBottom: 6 }}>
                <span>Memproses video dengan FFmpeg...</span>
                <span style={{ color: '#1D634E', fontWeight: 700 }}>
                  {renderProgress}% {renderEta !== null ? `(ETA: ${renderEta}s)` : ''}
                </span>
              </div>
              <div style={{ height: 6, background: '#D3D9D6', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    background: '#1D634E',
                    width: `${renderProgress}%`,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          )}

          {renderError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#B54329', fontSize: 12, background: 'rgba(181, 67, 41, 0.08)', padding: '10px 14px', borderRadius: 8 }}>
              <Icon icon="solar:danger-circle-bold-duotone" width={16} height={16} />
              {renderError}
            </div>
          )}
        </div>

        {/* Panel AI Metadata: Judul, Deskripsi, Hashtag */}
        <div
          style={{
            background: '#F6F4F1',
            border: '1px solid #D3D9D6',
            borderRadius: 16,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            boxShadow: '0 1px 3px rgba(17,25,22,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 14, color: '#111916', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon icon="solar:magic-stick-3-bold-duotone" width={18} height={18} style={{ color: '#1D634E' }} />
              METADATA POSTING MEDSOS
            </span>
            <button
              onClick={handleGenerateMetadata}
              disabled={loadingMeta}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 8,
                border: 'none',
                background: '#1D634E',
                color: '#F6F4F1',
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 700,
                fontSize: 11,
                cursor: loadingMeta ? 'not-allowed' : 'pointer',
              }}
            >
              {loadingMeta ? (
                <Icon icon="solar:refresh-circle-bold-duotone" width={14} height={14} className="animate-spin" />
              ) : (
                <Icon icon="solar:magic-stick-3-bold-duotone" width={14} height={14} />
              )}
              Generate Judul &amp; Tag
            </button>
          </div>

          {metaResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Judul Posting */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#5A635F', marginBottom: 2 }}>
                  <span>JUDUL KONTEN</span>
                  <button
                    onClick={() => copyToClipboard(metaResult.title, 'title')}
                    style={{ background: 'none', border: 'none', color: copiedField === 'title' ? '#1D634E' : '#5A635F', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 700 }}
                  >
                    <Icon icon={copiedField === 'title' ? 'solar:check-circle-bold-duotone' : 'solar:copy-bold-duotone'} width={12} height={12} />
                    {copiedField === 'title' ? 'Tersalin' : 'Salin'}
                  </button>
                </div>
                <div style={{ background: '#EFF2F0', padding: '10px 12px', borderRadius: 8, fontSize: 12, color: '#111916', fontWeight: 600, border: '1px solid #D3D9D6' }}>
                  {metaResult.title}
                </div>
              </div>

              {/* Deskripsi */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#5A635F', marginBottom: 2 }}>
                  <span>DESKRIPSI / CAPTION</span>
                  <button
                    onClick={() => copyToClipboard(metaResult.description, 'desc')}
                    style={{ background: 'none', border: 'none', color: copiedField === 'desc' ? '#1D634E' : '#5A635F', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 700 }}
                  >
                    <Icon icon={copiedField === 'desc' ? 'solar:check-circle-bold-duotone' : 'solar:copy-bold-duotone'} width={12} height={12} />
                    {copiedField === 'desc' ? 'Tersalin' : 'Salin'}
                  </button>
                </div>
                <div style={{ background: '#EFF2F0', padding: '10px 12px', borderRadius: 8, fontSize: 12, color: '#111916', lineHeight: 1.5, border: '1px solid #D3D9D6' }}>
                  {metaResult.description}
                </div>
              </div>

              {/* Hashtag */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#5A635F', marginBottom: 2 }}>
                  <span>HASHTAG VIRAL</span>
                  <button
                    onClick={() => copyToClipboard(metaResult.hashtags.join(' '), 'tags')}
                    style={{ background: 'none', border: 'none', color: copiedField === 'tags' ? '#1D634E' : '#5A635F', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, fontSize: 10, fontWeight: 700 }}
                  >
                    <Icon icon={copiedField === 'tags' ? 'solar:check-circle-bold-duotone' : 'solar:copy-bold-duotone'} width={12} height={12} />
                    {copiedField === 'tags' ? 'Tersalin' : 'Salin Semua'}
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {metaResult.hashtags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: 11,
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: 'rgba(29, 99, 78, 0.12)',
                        color: '#1D634E',
                        fontWeight: 700,
                        border: '1px solid rgba(29, 99, 78, 0.2)',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
