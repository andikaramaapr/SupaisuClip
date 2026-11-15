import { useState, useEffect, useRef } from 'react';
import {
  Download,
  Film,
  Sparkles,
  Settings,
  AlertCircle,
  Loader2,
  Copy,
  Check,
} from 'lucide-react';
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

    const payload = {
      ...edit,
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
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.6fr', gap: 24, alignItems: 'start' }}>
      {/* Kolom Kiri: Player Hasil Render & Final Preview */}
      <div
        style={{
          background: '#12121A',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 15, color: '#E8E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Hasil Render / Preview 9:16</span>
          <span style={{ fontSize: 11, color: '#C6FF3D', background: 'rgba(198,255,61,0.1)', padding: '3px 8px', borderRadius: 4 }}>
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
            background: '#000',
            borderRadius: 10,
            overflow: 'hidden',
            boxShadow: '0 10px 40px rgba(0,0,0,0.8)',
            border: '1px solid rgba(255,255,255,0.1)',
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
                  background: 'rgba(0,0,0,0.8)',
                  padding: '3px 8px',
                  borderRadius: 4,
                  fontSize: 10,
                  color: '#E100FF',
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 700,
                  border: '1px solid rgba(225,0,255,0.4)',
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
                  background: 'rgba(0,0,0,0.75)',
                  padding: '3px 8px',
                  borderRadius: 4,
                  fontSize: 10,
                  color: '#C6FF3D',
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
                borderRadius: 8,
                background: '#C6FF3D',
                color: '#0B0B10',
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 800,
                fontSize: 13,
                textDecoration: 'none',
                letterSpacing: '0.04em',
                boxShadow: '0 0 20px rgba(198,255,61,0.3)',
              }}
            >
              <Download size={16} />
              DOWNLOAD VIDEO MP4
            </a>
            <div style={{ fontSize: 11, color: '#7A7A8A', textAlign: 'center' }}>
              Dirender dengan encoder: <strong style={{ color: '#E8E8F0' }}>{usedEncoder}</strong>
            </div>
          </div>
        )}

        {/* Riwayat Render Sesi Ini */}
        {renderHistory.length > 0 && (
          <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
            <div style={{ fontSize: 11, fontFamily: "'Montserrat', sans-serif", fontWeight: 700, color: '#7A7A8A', marginBottom: 8 }}>
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
                    background: '#17171F',
                    fontSize: 11,
                  }}
                >
                  <span className="truncate" style={{ color: '#E8E8F0', maxWidth: 180 }}>{item.filename}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#7A7A8A', fontSize: 10 }}>{item.time}</span>
                    <a href={item.url} download={item.filename} style={{ color: '#C6FF3D' }}>
                      <Download size={12} />
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
            background: '#12121A',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 14, color: '#E8E8F0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={15} style={{ color: '#C6FF3D' }} />
            PENGATURAN EXPORT FFmpeg
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {/* Resolusi */}
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#7A7A8A', marginBottom: 4, fontWeight: 600 }}>
                RESOLUSI VERTICAL
              </label>
              <select
                value={edit.resolution}
                onChange={(e) => setEdit({ resolution: parseInt(e.target.value, 10) as 1080 | 720 })}
                style={{
                  width: '100%',
                  background: '#0B0B10',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 6,
                  color: '#E8E8F0',
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
              <label style={{ display: 'block', fontSize: 11, color: '#7A7A8A', marginBottom: 4, fontWeight: 600 }}>
                ENCODER VIDEO
              </label>
              <select
                value={edit.encoder}
                onChange={(e) => setEdit({ encoder: e.target.value })}
                style={{
                  width: '100%',
                  background: '#0B0B10',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 6,
                  color: '#E8E8F0',
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
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#7A7A8A', marginBottom: 4 }}>
                <span>KUALITAS (CRF)</span>
                <span style={{ color: '#C6FF3D' }}>{edit.crf} (Semakin kecil semakin tajam)</span>
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
              <label style={{ display: 'block', fontSize: 11, color: '#7A7A8A', marginBottom: 4, fontWeight: 600 }}>
                FRAME RATE (FPS)
              </label>
              <select
                value={edit.fps ?? ''}
                onChange={(e) => setEdit({ fps: e.target.value ? parseInt(e.target.value, 10) : null })}
                style={{
                  width: '100%',
                  background: '#0B0B10',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 6,
                  color: '#E8E8F0',
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
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'transparent',
                color: '#E8E8F0',
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 700,
                fontSize: 11,
                cursor: rendering ? 'not-allowed' : 'pointer',
              }}
            >
              <Film size={14} />
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
                borderRadius: 8,
                border: 'none',
                background: '#C6FF3D',
                color: '#0B0B10',
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 800,
                fontSize: 13,
                cursor: rendering ? 'not-allowed' : 'pointer',
                letterSpacing: '0.04em',
                boxShadow: '0 0 25px rgba(198,255,61,0.25)',
              }}
            >
              {rendering ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}
              {rendering ? 'SEDANG MERENDER...' : `RENDER KLIP ${edit.resolution}P`}
            </button>
          </div>

          {/* Indikator Progres Render Nyata */}
          {rendering && (
            <div style={{ marginTop: 8, background: '#0B0B10', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#7A7A8A', marginBottom: 6 }}>
                <span>Memproses video dengan FFmpeg...</span>
                <span style={{ color: '#C6FF3D', fontWeight: 700 }}>
                  {renderProgress}% {renderEta !== null ? `(ETA: ${renderEta}s)` : ''}
                </span>
              </div>
              <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    background: '#C6FF3D',
                    width: `${renderProgress}%`,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          )}

          {renderError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#FF5A36', fontSize: 12 }}>
              <AlertCircle size={15} />
              {renderError}
            </div>
          )}
        </div>

        {/* Panel AI Metadata: Judul, Deskripsi, Hashtag */}
        <div
          style={{
            background: '#12121A',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 14, color: '#E8E8F0', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={15} style={{ color: '#C6FF3D' }} />
              METADATA POSTING MEDSOS
            </span>
            <button
              onClick={handleGenerateMetadata}
              disabled={loadingMeta}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 6,
                border: 'none',
                background: 'rgba(198,255,61,0.15)',
                color: '#C6FF3D',
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 700,
                fontSize: 11,
                cursor: loadingMeta ? 'not-allowed' : 'pointer',
              }}
            >
              {loadingMeta ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              Generate Judul &amp; Tag
            </button>
          </div>

          {metaResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Judul Posting */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#7A7A8A', marginBottom: 2 }}>
                  <span>JUDUL KONTEN</span>
                  <button
                    onClick={() => copyToClipboard(metaResult.title, 'title')}
                    style={{ background: 'none', border: 'none', color: copiedField === 'title' ? '#C6FF3D' : '#7A7A8A', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, fontSize: 10 }}
                  >
                    {copiedField === 'title' ? <Check size={10} /> : <Copy size={10} />}
                    {copiedField === 'title' ? 'Tersalin' : 'Salin'}
                  </button>
                </div>
                <div style={{ background: '#0B0B10', padding: '8px 10px', borderRadius: 6, fontSize: 12, color: '#E8E8F0', fontWeight: 600 }}>
                  {metaResult.title}
                </div>
              </div>

              {/* Deskripsi */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#7A7A8A', marginBottom: 2 }}>
                  <span>DESKRIPSI / CAPTION</span>
                  <button
                    onClick={() => copyToClipboard(metaResult.description, 'desc')}
                    style={{ background: 'none', border: 'none', color: copiedField === 'desc' ? '#C6FF3D' : '#7A7A8A', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, fontSize: 10 }}
                  >
                    {copiedField === 'desc' ? <Check size={10} /> : <Copy size={10} />}
                    {copiedField === 'desc' ? 'Tersalin' : 'Salin'}
                  </button>
                </div>
                <div style={{ background: '#0B0B10', padding: '8px 10px', borderRadius: 6, fontSize: 12, color: '#E8E8F0', lineHeight: 1.5 }}>
                  {metaResult.description}
                </div>
              </div>

              {/* Hashtag */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#7A7A8A', marginBottom: 2 }}>
                  <span>HASHTAG VIRAL</span>
                  <button
                    onClick={() => copyToClipboard(metaResult.hashtags.join(' '), 'tags')}
                    style={{ background: 'none', border: 'none', color: copiedField === 'tags' ? '#C6FF3D' : '#7A7A8A', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, fontSize: 10 }}
                  >
                    {copiedField === 'tags' ? <Check size={10} /> : <Copy size={10} />}
                    {copiedField === 'tags' ? 'Tersalin' : 'Salin Semua'}
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {metaResult.hashtags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: 11,
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: 'rgba(198,255,61,0.1)',
                        color: '#C6FF3D',
                        fontWeight: 600,
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
