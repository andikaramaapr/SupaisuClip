import { Icon } from '@iconify/react';
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      {/* Banner Notifikasi Download YouTube di Background */}
      {isDownloadingYoutube && (
        <div
          style={{
            background: '#EFF2F0',
            border: '1px solid #D3D9D6',
            borderRadius: 12,
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon icon="solar:refresh-circle-bold-duotone" width={20} height={20} className="animate-spin" style={{ color: '#1D634E' }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111916', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon icon="solar:videocamera-record-bold-duotone" width={16} height={16} style={{ color: '#1D634E' }} />
                <span>{youtubeDownloadStage || 'Mengunduh video HD YouTube di latar belakang...'}</span>
              </div>
              <div style={{ fontSize: 12, color: '#5A635F', marginTop: 1 }}>
                Kamu sudah bisa mengatur font, subtitle, hook, dan layout klip sekarang. Video akan otomatis muncul begitu selesai diunduh.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 200 }}>
            <div style={{ flex: 1, height: 6, background: '#D3D9D6', borderRadius: 3, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  background: '#1D634E',
                  width: `${youtubeDownloadProgress}%`,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: '#1D634E', fontWeight: 700, width: 36, textAlign: 'right' }}>
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
            background: '#F6F4F1',
            border: '1px solid #D3D9D6',
            borderRadius: 12,
            padding: '8px 14px',
            overflowX: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: "'Montserrat', sans-serif", fontWeight: 700, color: '#5A635F', whiteSpace: 'nowrap', paddingRight: 8, borderRight: '1px solid #D3D9D6' }}>
            <Icon icon="solar:scissors-bold-duotone" width={16} height={16} style={{ color: '#1D634E' }} />
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
                    borderRadius: 8,
                    border: isActive ? '1px solid #1D634E' : '1px solid #D3D9D6',
                    background: isActive ? '#1D634E' : '#EFF2F0',
                    color: isActive ? '#F6F4F1' : '#5A635F',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontFamily: "'Montserrat', sans-serif",
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isActive && <Icon icon="solar:check-circle-bold-duotone" width={14} height={14} />}
                  <span>Klip #{idx + 1}: {clip.title.length > 20 ? clip.title.substring(0, 18) + '...' : clip.title}</span>
                  <span style={{ fontSize: 10, opacity: 0.8, fontFamily: "'JetBrains Mono', monospace" }}>
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
          background: '#F6F4F1',
          borderRadius: 16,
          overflow: 'hidden',
          border: '1px solid #D3D9D6',
          boxShadow: '0 1px 4px rgba(17,25,22,0.04)',
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
