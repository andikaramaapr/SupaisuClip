import { Loader2, Scissors, CheckCircle2, Film } from 'lucide-react';
import EditLeftPanel from './EditLeftPanel';
import EditCenterCanvas from './EditCenterCanvas';
import EditRightStyler from './EditRightStyler';
import { useStore } from '../store';

export default function EditStep() {
  const {
    clips,
    markedClipIds,
    activeClipId,
    setActiveClipId,
    isDownloadingYoutube,
    youtubeDownloadProgress,
    youtubeDownloadStage,
  } = useStore();

  // Daftar klip yang sedang di-mark (jika kosong, fallback ke semua clips)
  const displayClips = clips.filter((c) =>
    markedClipIds.length > 0 ? (c.id ? markedClipIds.includes(c.id) : false) : true
  );

  const formatSec = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Banner Notifikasi Download YouTube di Background */}
      {isDownloadingYoutube && (
        <div
          style={{
            background: 'linear-gradient(90deg, #181B10 0%, #12121A 100%)',
            border: '1px solid rgba(198,255,61,0.3)',
            borderRadius: 10,
            padding: '10px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Loader2 size={16} className="animate-spin" style={{ color: '#C6FF3D' }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#E8E8F0', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Film size={13} style={{ color: '#C6FF3D' }} />
                <span>{youtubeDownloadStage || 'Mengunduh video HD YouTube di latar belakang...'}</span>
              </div>
              <div style={{ fontSize: 11, color: '#7A7A8A', marginTop: 1 }}>
                Kamu sudah bisa mengatur font, subtitle, hook, dan layout klip sekarang. Video akan otomatis muncul begitu selesai diunduh.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 200 }}>
            <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  background: '#C6FF3D',
                  width: `${youtubeDownloadProgress}%`,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#C6FF3D', fontWeight: 700, width: 36, textAlign: 'right' }}>
              {youtubeDownloadProgress}%
            </span>
          </div>
        </div>
      )}

      {/* Bar Clip Switcher di Paling Atas Tahap 3 */}
      {displayClips.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: '#12121A',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 10,
            padding: '8px 14px',
            overflowX: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: "'Montserrat', sans-serif", fontWeight: 700, color: '#7A7A8A', whiteSpace: 'nowrap', paddingRight: 6, borderRight: '1px solid rgba(255,255,255,0.08)' }}>
            <Scissors size={13} style={{ color: '#C6FF3D' }} />
            CLIP SWITCHER ({displayClips.length})
          </div>

          <div style={{ display: 'flex', gap: 8, flex: 1 }}>
            {displayClips.map((clip, idx) => {
              const clipId = clip.id || `clip_${idx}`;
              const isActive = activeClipId === clipId;
              const dur = Math.round(clip.duration || clip.end - clip.start);

              return (
                <button
                  key={clipId}
                  onClick={() => setActiveClipId(clipId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 14px',
                    borderRadius: 7,
                    border: isActive ? '1px solid #C6FF3D' : '1px solid rgba(255,255,255,0.08)',
                    background: isActive ? 'rgba(198,255,61,0.15)' : 'rgba(255,255,255,0.02)',
                    color: isActive ? '#C6FF3D' : '#A0A0B0',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontFamily: "'Montserrat', sans-serif",
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s',
                  }}
                >
                  {isActive && <CheckCircle2 size={12} />}
                  <span>Klip #{idx + 1}: {clip.title.length > 20 ? clip.title.substring(0, 18) + '...' : clip.title}</span>
                  <span style={{ fontSize: 10, opacity: 0.7, fontFamily: "'JetBrains Mono', monospace" }}>
                    ({dur}s | {formatSec(clip.start)})
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Editor Utama Studio 3 Kolom */}
      <div
        style={{
          display: 'flex',
          height: 'calc(100vh - 140px)',
          minHeight: 640,
          background: '#0B0B10',
          borderRadius: 12,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {/* Kolom Kiri: SRT, Hook, SFX, Font */}
        <EditLeftPanel />

        {/* Kolom Tengah: Source Frame Webcam & Live Preview Canvas 9:16 */}
        <EditCenterCanvas />

        {/* Kolom Kanan: Preset Gaya, Subtitle Styler, AI Tools, & Render */}
        <EditRightStyler />
      </div>
    </div>
  );
}
