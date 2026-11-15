import { useState, useEffect, useRef } from 'react';
import {
  Tv,
  Upload,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Film,
  ArrowRight,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { useStore } from '../store';
import {
  fetchYoutubeInfo,
  fetchYoutubeSubtitles,
  uploadProject,
  uploadSrt,
  validateSrt,
  getVideoProxy,
} from '../api';
import type { SubSource } from '../types';

/** Extract YouTube video ID from various URL formats */
function extractYoutubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /youtube\.com\/v\/([A-Za-z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

export default function SourceStep() {
  const {
    youtubeUrl,
    setYoutubeUrl,
    youtubeInfo,
    setYoutubeInfo,
    setYoutubeVideoId,
    ytJobId,
    setVideoMeta,
    setVideoUrl,
    srtSource,
    setSrtSource,
    edit,
    setEdit,
    setStep,
  } = useStore();

  const [activeTab, setActiveTab] = useState<'youtube' | 'upload'>('youtube');
  const [ytUrl, setYtUrl] = useState(youtubeUrl || '');
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [infoError, setInfoError] = useState('');
  const [switchingSub, setSwitchingSub] = useState(false);

  // Subtitle selection for YouTube
  const [selectedSubLang, setSelectedSubLang] = useState('');
  const [selectedSubSource, setSelectedSubSource] = useState<SubSource>('none');

  // Upload local video state
  const [localVideoFile, setLocalVideoFile] = useState<File | null>(null);
  const [localSrtFile, setLocalSrtFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const videoInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);

  // SRT validation problems
  const [srtProblems, setSrtProblems] = useState<Array<{ block: number; message: string }>>([]);
  const [validatingSrt, setValidatingSrt] = useState(false);

  // Find & Replace
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [showFindReplace, setShowFindReplace] = useState(false);

  // Sync state if youtubeInfo already exists
  useEffect(() => {
    if (youtubeInfo?.default_sub && !selectedSubLang) {
      setSelectedSubLang(youtubeInfo.default_sub.lang);
      setSelectedSubSource(youtubeInfo.default_sub.source);
    }
  }, [youtubeInfo, selectedSubLang]);

  // Validate SRT when edit.srt_text changes
  useEffect(() => {
    if (!edit.srt_text.trim()) {
      setSrtProblems([]);
      return;
    }
    const timer = setTimeout(async () => {
      setValidatingSrt(true);
      try {
        const res = await validateSrt(edit.srt_text);
        setSrtProblems(res.problems);
      } catch {
        // ignore
      } finally {
        setValidatingSrt(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [edit.srt_text]);

  // Handler: Ambil Info YouTube + Subtitle Instan (Tanpa Download Video)
  const handleFetchYoutubeInfo = async () => {
    const targetUrl = ytUrl.trim();
    if (!targetUrl) return;
    setLoadingInfo(true);
    setInfoError('');

    try {
      const info = await fetchYoutubeInfo(targetUrl);
      setYoutubeUrl(targetUrl);
      setYoutubeInfo(info);

      // Extract and store YouTube video ID for IFrame preview
      const vid = extractYoutubeId(targetUrl);
      setYoutubeVideoId(vid);

      // Also store youtube_url in edit state for slice-on-export
      setEdit({ youtube_url: targetUrl });

      // Simpan metadata awal dari info YouTube
      setVideoMeta({
        duration: info.duration || 300,
        width: info.width || 1920,
        height: info.height || 1080,
        fps: 30,
        codec: 'h264',
        has_audio: true,
        orientation: info.width && info.height && info.width < info.height ? 'portrait' : 'landscape',
        needs_proxy: false,
      });

      // Otomatis masukkan subtitle default jika didapat
      if (info.srt_text) {
        setEdit({ srt_text: info.srt_text });
        setSrtSource(info.srt_source === 'manual' ? 'youtube-manual' : info.srt_source === 'auto' ? 'youtube-auto' : 'none');
      }

      if (info.default_sub) {
        setSelectedSubLang(info.default_sub.lang);
        setSelectedSubSource(info.default_sub.source);
      } else {
        setSelectedSubLang('');
        setSelectedSubSource('none');
      }
    } catch (e: unknown) {
      setInfoError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingInfo(false);
    }
  };

  // Handler: Ganti Subtitle YouTube lewat Dropdown
  const handleSelectSubtitleOption = async (src: SubSource, lang: string) => {
    setSelectedSubSource(src);
    setSelectedSubLang(lang);

    if (src === 'none' || !lang) {
      return;
    }

    const currentUrl = ytUrl.trim() || youtubeUrl;
    if (!currentUrl) return;

    setSwitchingSub(true);
    try {
      const res = await fetchYoutubeSubtitles(currentUrl, ytJobId || '', lang, src as 'manual' | 'auto');
      setEdit({ srt_text: res.srt_text });
      setSrtSource(res.srt_source === 'manual' ? 'youtube-manual' : 'youtube-auto');
    } catch (e: unknown) {
      setInfoError(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitchingSub(false);
    }
  };

  // Handler: Kembalikan Subtitle YouTube Default
  const handleRestoreYoutubeSubtitles = async () => {
    const currentUrl = ytUrl.trim() || youtubeUrl;
    if (!currentUrl || !selectedSubLang || selectedSubSource === 'none') return;
    setSwitchingSub(true);
    try {
      const res = await fetchYoutubeSubtitles(currentUrl, ytJobId || '', selectedSubLang, selectedSubSource as 'manual' | 'auto');
      setEdit({ srt_text: res.srt_text });
      setSrtSource(res.srt_source === 'manual' ? 'youtube-manual' : 'youtube-auto');
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitchingSub(false);
    }
  };

  // Handler: Upload File Video Manual
  const handleUploadProject = async () => {
    if (!localVideoFile) return;
    setUploading(true);
    setUploadError('');

    try {
      const res = await uploadProject(localVideoFile, localSrtFile ?? undefined);
      setEdit({
        video_filename: res.video_filename,
        srt_text: res.srt_text || '',
      });
      setVideoMeta(res.meta);
      setVideoUrl(res.video_url, res.video_url);
      setSrtSource(res.srt_text ? 'upload' : 'none');

      // Cek proxy jika perlu
      if (res.meta.needs_proxy) {
        try {
          const proxyRes = await getVideoProxy(res.video_filename);
          setVideoUrl(res.video_url, proxyRes.preview_url);
        } catch {
          // ignore proxy error
        }
      }
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  // Handler: Upload SRT Pengganti
  const handleUploadReplacementSrt = async (file: File) => {
    try {
      const res = await uploadSrt(file);
      setEdit({ srt_text: res.srt_text });
      setSrtSource('upload');
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  // Handler: Find & Replace pada SRT
  const handleFindReplace = () => {
    if (!findText) return;
    const newText = edit.srt_text.split(findText).join(replaceText);
    setEdit({ srt_text: newText });
    setFindText('');
    setReplaceText('');
    setShowFindReplace(false);
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Syarat siap lanjut ke Tahap 2: ada SRT dan ada sumber video (YouTube info atau upload)
  const isSourceReady = Boolean(
    edit.srt_text.trim() && (youtubeInfo || youtubeUrl || edit.video_filename)
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Tab Switcher: YouTube Link vs Upload Video */}
      <div
        style={{
          display: 'flex',
          background: '#12121A',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10,
          padding: 4,
          width: 'fit-content',
        }}
      >
        <button
          onClick={() => setActiveTab('youtube')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 18px',
            borderRadius: 7,
            border: 'none',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 700,
            letterSpacing: '0.04em',
            background: activeTab === 'youtube' ? 'rgba(198,255,61,0.15)' : 'transparent',
            color: activeTab === 'youtube' ? '#C6FF3D' : '#7A7A8A',
            transition: 'all 0.15s',
          }}
        >
          <Tv size={15} />
          YOUTUBE URL
        </button>
        <button
          onClick={() => setActiveTab('upload')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 18px',
            borderRadius: 7,
            border: 'none',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 700,
            letterSpacing: '0.04em',
            background: activeTab === 'upload' ? 'rgba(198,255,61,0.15)' : 'transparent',
            color: activeTab === 'upload' ? '#C6FF3D' : '#7A7A8A',
            transition: 'all 0.15s',
          }}
        >
          <Upload size={15} />
          UPLOAD VIDEO
        </button>
      </div>

      {/* Konten Tab 1: YouTube */}
      {activeTab === 'youtube' && (
        <div
          style={{
            background: '#12121A',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          <div>
            <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 800, fontSize: 16, color: '#E8E8F0', marginBottom: 6 }}>
              Ambil Subtitle &amp; Video dari YouTube
            </div>
            <div style={{ fontSize: 12, color: '#7A7A8A', lineHeight: 1.5 }}>
              Masukkan link YouTube. Subtitle akan langsung diambil dan dimuat dalam beberapa detik agar kamu bisa segera memilih momen viral di Tahap 2. Video utuh baru diunduh saat kamu melanjutkan ke pengeditan.
            </div>
          </div>

          {/* Input URL */}
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              type="text"
              placeholder="https://www.youtube.com/watch?v=..."
              value={ytUrl}
              onChange={(e) => setYtUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFetchYoutubeInfo();
              }}
              disabled={loadingInfo}
              style={{
                flex: 1,
                background: '#0B0B10',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8,
                padding: '10px 14px',
                color: '#E8E8F0',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <button
              onClick={handleFetchYoutubeInfo}
              disabled={loadingInfo || !ytUrl.trim()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 22px',
                borderRadius: 8,
                border: 'none',
                cursor: loadingInfo || !ytUrl.trim() ? 'not-allowed' : 'pointer',
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 700,
                fontSize: 12,
                background: '#C6FF3D',
                color: '#0B0B10',
                opacity: loadingInfo || !ytUrl.trim() ? 0.5 : 1,
                boxShadow: ytUrl.trim() ? '0 0 16px rgba(198,255,61,0.2)' : 'none',
              }}
            >
              {loadingInfo ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {loadingInfo ? 'Mengambil Subtitle...' : 'Ambil Subtitle & Info'}
            </button>
          </div>

          {infoError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#FF5A36', fontSize: 12 }}>
              <AlertCircle size={14} />
              {infoError}
            </div>
          )}

          {/* Info Card setelah di-fetch */}
          {youtubeInfo && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '220px 1fr',
                gap: 20,
                background: '#17171F',
                border: '1px solid rgba(198,255,61,0.15)',
                borderRadius: 10,
                padding: 16,
              }}
            >
              <img
                src={youtubeInfo.thumbnail}
                alt="Thumbnail"
                style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 6 }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 14, color: '#E8E8F0' }}>
                  {youtubeInfo.title}
                </div>
                <div style={{ fontSize: 12, color: '#7A7A8A', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <span>Channel: <strong style={{ color: '#E8E8F0' }}>{youtubeInfo.uploader}</strong></span>
                  <span>Durasi: <strong style={{ color: '#E8E8F0' }}>{formatSeconds(youtubeInfo.duration)}</strong></span>
                  <span>Resolusi: <strong style={{ color: '#E8E8F0' }}>{youtubeInfo.width}x{youtubeInfo.height}</strong></span>
                </div>

                {/* Pemilih Subtitle Bawaan YouTube */}
                <div style={{ marginTop: 6 }}>
                  <label style={{ display: 'block', fontSize: 11, fontFamily: "'Montserrat', sans-serif", fontWeight: 700, color: '#7A7A8A', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Pilih Track Subtitle YouTube:
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <select
                      value={`${selectedSubSource}:${selectedSubLang}`}
                      onChange={(e) => {
                        const [src, lang] = e.target.value.split(':');
                        handleSelectSubtitleOption(src as SubSource, lang || '');
                      }}
                      disabled={switchingSub}
                      style={{
                        background: '#0B0B10',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 6,
                        color: '#E8E8F0',
                        padding: '8px 12px',
                        fontSize: 12,
                        outline: 'none',
                        maxWidth: 380,
                        cursor: switchingSub ? 'wait' : 'pointer',
                      }}
                    >
                      <option value="none:">Tanpa Subtitle YouTube (Gunakan Upload SRT)</option>
                      {youtubeInfo.subs.manual.map((m) => (
                        <option key={`manual:${m.lang}`} value={`manual:${m.lang}`}>
                          🌟 Subtitle Manual: {m.label || m.lang} ({m.lang})
                        </option>
                      ))}
                      {youtubeInfo.subs.auto.map((a) => (
                        <option key={`auto:${a.lang}`} value={`auto:${a.lang}`}>
                          ⚡ Auto-caption YouTube: {a.label || a.lang} ({a.lang})
                        </option>
                      ))}
                    </select>

                    {switchingSub && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#C6FF3D' }}>
                        <Loader2 size={12} className="animate-spin" />
                        Memuat subtitle...
                      </div>
                    )}
                  </div>
                </div>

                {/* Status info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#C6FF3D', marginTop: 4 }}>
                  <CheckCircle2 size={13} />
                  <span>Metadata &amp; Subtitle telah siap! Kamu bisa langsung lanjut ke Analisis AI di bawah.</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Konten Tab 2: Upload Video Manual */}
      {activeTab === 'upload' && (
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
          <div>
            <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 800, fontSize: 16, color: '#E8E8F0', marginBottom: 6 }}>
              Upload Video Lokal (.mp4, .mov, .webm)
            </div>
            <div style={{ fontSize: 12, color: '#7A7A8A', lineHeight: 1.5 }}>
              Pilih file video dan file SRT opsional dari komputer kamu.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Box Video */}
            <div
              onClick={() => videoInputRef.current?.click()}
              style={{
                border: '1.5px dashed rgba(255,255,255,0.15)',
                borderRadius: 10,
                padding: '24px 16px',
                textAlign: 'center',
                cursor: 'pointer',
                background: 'rgba(255,255,255,0.02)',
                transition: 'all 0.15s',
              }}
            >
              <input
                ref={videoInputRef}
                type="file"
                accept=".mp4,.mov,.webm,.mkv"
                style={{ display: 'none' }}
                onChange={(e) => setLocalVideoFile(e.target.files?.[0] ?? null)}
              />
              <Film size={28} style={{ color: '#C6FF3D', margin: '0 auto 10px' }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: '#E8E8F0' }}>
                {localVideoFile ? localVideoFile.name : 'Pilih File Video (.mp4 / .mov)'}
              </div>
              <div style={{ fontSize: 11, color: '#7A7A8A', marginTop: 4 }}>
                {localVideoFile ? `${(localVideoFile.size / (1024 * 1024)).toFixed(1)} MB` : 'Klik untuk mencari file'}
              </div>
            </div>

            {/* Box SRT */}
            <div
              onClick={() => srtInputRef.current?.click()}
              style={{
                border: '1.5px dashed rgba(255,255,255,0.15)',
                borderRadius: 10,
                padding: '24px 16px',
                textAlign: 'center',
                cursor: 'pointer',
                background: 'rgba(255,255,255,0.02)',
                transition: 'all 0.15s',
              }}
            >
              <input
                ref={srtInputRef}
                type="file"
                accept=".srt"
                style={{ display: 'none' }}
                onChange={(e) => setLocalSrtFile(e.target.files?.[0] ?? null)}
              />
              <FileText size={28} style={{ color: '#C6FF3D', margin: '0 auto 10px' }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: '#E8E8F0' }}>
                {localSrtFile ? localSrtFile.name : 'File Subtitle .srt (Opsional)'}
              </div>
              <div style={{ fontSize: 11, color: '#7A7A8A', marginTop: 4 }}>
                {localSrtFile ? 'Subtitle terpilih' : 'Akan dimuat otomatis jika dipilih'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 6 }}>
            <button
              onClick={handleUploadProject}
              disabled={uploading || !localVideoFile}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 24px',
                borderRadius: 8,
                border: 'none',
                cursor: uploading || !localVideoFile ? 'not-allowed' : 'pointer',
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 800,
                fontSize: 12,
                background: '#C6FF3D',
                color: '#0B0B10',
                letterSpacing: '0.04em',
                opacity: uploading || !localVideoFile ? 0.5 : 1,
              }}
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploading ? 'MENGUPLOAD...' : 'UPLOAD VIDEO KE PROYEK'}
            </button>
          </div>

          {uploadError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#FF5A36', fontSize: 12 }}>
              <AlertCircle size={14} />
              {uploadError}
            </div>
          )}
        </div>
      )}

      {/* Editor Subtitle SRT Langsung */}
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 800, fontSize: 15, color: '#E8E8F0' }}>
                Editor Subtitle SRT
              </span>

              {/* Badge Sumber Subtitle */}
              {srtSource === 'youtube-manual' && (
                <span style={{ padding: '3px 8px', borderRadius: 4, background: 'rgba(198,255,61,0.15)', color: '#C6FF3D', fontSize: 11, fontWeight: 700 }}>
                  ✓ Subtitle manual YouTube
                </span>
              )}
              {srtSource === 'youtube-auto' && (
                <span style={{ padding: '3px 8px', borderRadius: 4, background: 'rgba(255,170,0,0.15)', color: '#FFAA00', fontSize: 11, fontWeight: 700 }}>
                  ⚡ Auto-caption YouTube (dibersihkan)
                </span>
              )}
              {srtSource === 'upload' && (
                <span style={{ padding: '3px 8px', borderRadius: 4, background: 'rgba(56,189,248,0.15)', color: '#38BDF8', fontSize: 11, fontWeight: 700 }}>
                  📁 File SRT Upload
                </span>
              )}
              {srtSource === 'none' && (
                <span style={{ padding: '3px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: '#7A7A8A', fontSize: 11, fontWeight: 600 }}>
                  Belum ada subtitle
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#7A7A8A', marginTop: 4 }}>
              Analisis momen viral AI mengandalkan transkrip ini. Kamu bisa mengedit langsung teks atau timestamp di bawah.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {/* Tombol Kembalikan ke Subtitle YouTube */}
            {youtubeInfo && (
              <button
                onClick={handleRestoreYoutubeSubtitles}
                title="Muat ulang subtitle asli YouTube"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
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
                <RotateCcw size={12} />
                Reset ke Subtitle YT
              </button>
            )}

            {/* Tombol Upload SRT Pengganti */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
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
              <Upload size={12} />
              Upload SRT Pengganti
              <input
                type="file"
                accept=".srt"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUploadReplacementSrt(f);
                }}
              />
            </label>

            {/* Tombol Find & Replace */}
            <button
              onClick={() => setShowFindReplace((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.12)',
                background: showFindReplace ? 'rgba(198,255,61,0.1)' : 'transparent',
                color: showFindReplace ? '#C6FF3D' : '#7A7A8A',
                cursor: 'pointer',
                fontSize: 11,
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 600,
              }}
            >
              Find &amp; Replace
            </button>
          </div>
        </div>

        {/* Bar Find & Replace */}
        {showFindReplace && (
          <div
            style={{
              display: 'flex',
              gap: 10,
              background: '#17171F',
              padding: 10,
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <input
              type="text"
              placeholder="Cari kata..."
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              style={{
                flex: 1,
                background: '#0B0B10',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 6,
                padding: '6px 10px',
                color: '#E8E8F0',
                fontSize: 12,
              }}
            />
            <input
              type="text"
              placeholder="Ganti dengan..."
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              style={{
                flex: 1,
                background: '#0B0B10',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 6,
                padding: '6px 10px',
                color: '#E8E8F0',
                fontSize: 12,
              }}
            />
            <button
              onClick={handleFindReplace}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: 'none',
                background: '#C6FF3D',
                color: '#0B0B10',
                fontWeight: 700,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Ganti Semua
            </button>
          </div>
        )}

        {/* Textarea Editor */}
        <textarea
          value={edit.srt_text}
          onChange={(e) => setEdit({ srt_text: e.target.value })}
          placeholder={`1\n00:00:01,000 --> 00:00:04,000\nContoh teks transkrip video kamu di sini...`}
          style={{
            width: '100%',
            minHeight: 220,
            background: '#0B0B10',
            border: srtProblems.length > 0 ? '1px solid #FF5A36' : '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            padding: 14,
            color: '#E8E8F0',
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontSize: 12,
            lineHeight: 1.6,
            outline: 'none',
            resize: 'vertical',
          }}
        />

        {/* Validasi / Indikator Error SRT */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
          <div style={{ color: '#7A7A8A' }}>
            {validatingSrt ? 'Memeriksa format SRT...' : srtProblems.length === 0 ? (
              <span style={{ color: '#22C55E', display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={12} /> Format SRT valid ({edit.srt_text ? edit.srt_text.trim().split(/\n\s*\n/).length : 0} blok)
              </span>
            ) : (
              <span style={{ color: '#FF5A36', display: 'flex', alignItems: 'center', gap: 4 }}>
                <AlertCircle size={12} /> Ditemukan {srtProblems.length} masalah di baris SRT
              </span>
            )}
          </div>

          {srtProblems.length > 0 && (
            <div style={{ color: '#FF5A36', fontSize: 11 }}>
              Contoh: Blok {srtProblems[0].block} ({srtProblems[0].message})
            </div>
          )}
        </div>
      </div>

      {/* Banner & Tombol Utama: Lanjut ke Tahap 2 */}
      <div
        style={{
          background: isSourceReady ? '#12121A' : 'rgba(255,255,255,0.02)',
          border: isSourceReady ? '1px solid rgba(198,255,61,0.25)' : '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          padding: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 8,
              background: isSourceReady ? 'rgba(198,255,61,0.15)' : 'rgba(255,255,255,0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isSourceReady ? '#C6FF3D' : '#7A7A8A',
            }}
          >
            {isSourceReady ? <CheckCircle2 size={22} /> : <FileText size={22} />}
          </div>
          <div>
            <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 14, color: isSourceReady ? '#E8E8F0' : '#7A7A8A' }}>
              {isSourceReady ? 'Sumber & Subtitle Siap Dianalisis AI' : 'Menunggu Link YouTube atau File SRT'}
            </div>
            <div style={{ fontSize: 12, color: '#7A7A8A', marginTop: 2 }}>
              {isSourceReady
                ? (youtubeInfo ? `Video YouTube: "${youtubeInfo.title}" (${formatSeconds(youtubeInfo.duration)})` : `File video lokal: ${edit.video_filename}`)
                : 'Silakan ambil subtitle dari YouTube atau upload file SRT di atas untuk lanjut ke Tahap 2.'}
            </div>
          </div>
        </div>

        <button
          onClick={() => setStep(2)}
          disabled={!isSourceReady}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 28px',
            borderRadius: 8,
            border: 'none',
            cursor: isSourceReady ? 'pointer' : 'not-allowed',
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 800,
            fontSize: 13,
            background: '#C6FF3D',
            color: '#0B0B10',
            letterSpacing: '0.04em',
            opacity: isSourceReady ? 1 : 0.4,
            boxShadow: isSourceReady ? '0 0 24px rgba(198,255,61,0.3)' : 'none',
          }}
        >
          LANJUT KE ANALISIS AI (PILIH KLIP)
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
