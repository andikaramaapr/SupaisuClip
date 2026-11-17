import { useState, useRef, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { useStore } from '../store';
import { highlightWords, suggestStyle, uploadFont } from '../api';
import type { StyleKey, LetterStyle, SubtitleAnimation, LayoutMode, CameraKeyframe } from '../types';

interface PresetDef {
  key: StyleKey;
  titlePrefix: string;
  glowWord?: string;
  glowColor?: string;
  sub: string;
  primary: string | null;
  outline: string | null;
  highlight: string;
  marginV: number;
}

const PRESET_CARDS: PresetDef[] = [
  {
    key: 'viral_pop',
    titlePrefix: 'VIRAL ',
    glowWord: 'POP',
    glowColor: '#D97706',
    sub: 'Hormozi Yellow Glow',
    primary: '#FFFF00',
    outline: '#000000',
    highlight: '#FF3B3B',
    marginV: 340,
  },
  {
    key: 'beast_punch',
    titlePrefix: 'BEAST ',
    glowWord: 'PUNCH',
    glowColor: '#16A34A',
    sub: 'High Impact Green',
    primary: '#00FF00',
    outline: '#000000',
    highlight: '#FFFF00',
    marginV: 340,
  },
  {
    key: 'cyber_violet',
    titlePrefix: 'CYBER ',
    glowWord: 'VIOLET',
    glowColor: '#9333EA',
    sub: 'Neon Purple Glow',
    primary: '#CC00FF',
    outline: '#1A0033',
    highlight: '#00FFFF',
    marginV: 340,
  },
  {
    key: 'fire_crimson',
    titlePrefix: 'FIRE ',
    glowWord: 'CRIMSON',
    glowColor: '#DC2626',
    sub: 'High Energy Red',
    primary: '#FF2200',
    outline: '#000000',
    highlight: '#FFFF00',
    marginV: 340,
  },
  {
    key: 'electric_cyan',
    titlePrefix: 'ELECTRIC ',
    glowWord: 'CYAN',
    glowColor: '#0284C7',
    sub: 'Ice Blue Glow',
    primary: '#00FFFF',
    outline: '#002244',
    highlight: '#FF0088',
    marginV: 340,
  },
  {
    key: 'golden_aura',
    titlePrefix: 'GOLDEN ',
    glowWord: 'AURA',
    glowColor: '#CA8A04',
    sub: 'Luxury Warm Gold',
    primary: '#FFD422',
    outline: '#221100',
    highlight: '#FFFFFF',
    marginV: 340,
  },
  {
    key: 'clean_minimal',
    titlePrefix: 'Clean Minimal',
    sub: 'Soft Dark Box',
    primary: '#FFFFFF',
    outline: '#181818',
    highlight: '#38BDF8',
    marginV: 330,
  },
  {
    key: 'none',
    titlePrefix: '✕ NONE',
    sub: 'Burn No Captions',
    primary: null,
    outline: null,
    highlight: '#FF3B3B',
    marginV: 340,
  },
];

const DEFAULT_FONTS = [
  'Outfit',
  'Montserrat',
  'Inter',
  'Impact',
  'BEBAS NEUE',
  'Anton',
  'Poppins',
  'Arial Black',
];

export default function EditRightStyler() {
  const { edit, setEdit, fonts, setFonts, setStep, videoMeta, previewTime, requestSeek } = useStore();
  const clipDuration = Math.max(1, (edit.clip_end ?? videoMeta?.duration ?? 30) - edit.clip_start);

  // Helper sinkronisasi framing: perbarui edit dan perbarui keyframe jika playhead berada dekat (<= 0.15s)
  const updateMainFraming = (patch: Partial<typeof edit>) => {
    const curTime = previewTime || 0;
    const kfs = edit.camera_keyframes || [];
    const nearKfIndex = kfs.findIndex((k) => Math.abs(k.time - curTime) <= 0.15);

    if (nearKfIndex !== -1) {
      const updatedKfs = kfs.map((k, idx) => {
        if (idx !== nearKfIndex) return k;
        return {
          ...k,
          ...(patch.main_x_offset !== undefined ? { x_offset: patch.main_x_offset } : {}),
          ...(patch.main_y_offset !== undefined ? { y_offset: patch.main_y_offset } : {}),
          ...(patch.main_zoom !== undefined ? { zoom: patch.main_zoom } : {}),
        };
      });
      setEdit({ ...patch, camera_keyframes: updatedKfs });
    } else {
      setEdit(patch);
    }
  };

  const [activeSection, setActiveSection] = useState<'subtitle' | 'framing'>('subtitle');
  const [framingSubTab, setFramingSubTab] = useState<'static' | 'keyframes'>('static');
  const prevKfCountRef = useRef(edit.camera_keyframes?.length || 0);

  // Otomatis pindah ke sub-tab keyframes jika jumlah keyframe bertambah (misal dari tombol + Keyframe di timeline)
  useEffect(() => {
    const curCount = edit.camera_keyframes?.length || 0;
    if (curCount > prevKfCountRef.current) {
      setFramingSubTab('keyframes');
    }
    prevKfCountRef.current = curCount;
  }, [edit.camera_keyframes?.length]);

  // Helper pan cepat (Kiri/Tengah/Kanan) pada playhead aktif di mode keyframe
  const handleQuickPanKeyframe = (targetX: number) => {
    const targetTime = Math.max(0, Math.min(clipDuration, Number((previewTime || 0).toFixed(1))));
    const kfs = edit.camera_keyframes || [];
    const nearIdx = kfs.findIndex((k) => Math.abs(k.time - targetTime) <= 0.15);
    let updated: CameraKeyframe[];
    if (nearIdx !== -1) {
      updated = kfs.map((k, idx) => (idx === nearIdx ? { ...k, x_offset: targetX } : k)).sort((a, b) => a.time - b.time);
    } else {
      const newKf: CameraKeyframe = {
        id: `kf_${Date.now()}`,
        time: targetTime,
        x_offset: targetX,
        y_offset: edit.main_y_offset ?? 0.5,
        zoom: edit.main_zoom ?? 1.0,
        easing: 'smooth',
      };
      updated = [...kfs, newKf].sort((a, b) => a.time - b.time);
    }
    setEdit({ main_x_offset: targetX, camera_keyframes: updated });
  };
  const [loadingAiStyle, setLoadingAiStyle] = useState(false);
  const [loadingAiWords, setLoadingAiWords] = useState(false);
  const [newWordInput, setNewWordInput] = useState('');
  const [uploadingFont, setUploadingFont] = useState(false);
  const fontInputRef = useRef<HTMLInputElement>(null);

  // Klik kartu preset -> update style_key DAN warna default terkait
  const handleSelectPreset = (p: PresetDef) => {
    setEdit({
      style_key: p.key,
      primary_color: p.primary,
      outline_color: p.outline,
      highlight_color: p.highlight,
      subtitle_margin_v: p.marginV,
    });
  };

  // AI Suggest Style
  const handleSuggestStyle = async () => {
    if (!edit.srt_text.trim()) return;
    setLoadingAiStyle(true);
    try {
      const res = await suggestStyle(edit.srt_text, edit.clip_start, edit.clip_end);
      const match = PRESET_CARDS.find((c) => c.key === res.style_key);
      if (match) {
        handleSelectPreset(match);
      } else {
        setEdit({ style_key: res.style_key as StyleKey });
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingAiStyle(false);
    }
  };

  // AI Highlight Words
  const handleHighlightWords = async () => {
    if (!edit.srt_text.trim()) return;
    setLoadingAiWords(true);
    try {
      const res = await highlightWords(edit.srt_text, edit.clip_start, edit.clip_end);
      setEdit({ highlight_words: res.words || [] });
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingAiWords(false);
    }
  };

  const handleAddWord = () => {
    if (!newWordInput.trim()) return;
    const clean = newWordInput.trim();
    if (!edit.highlight_words.includes(clean)) {
      setEdit({ highlight_words: [...edit.highlight_words, clean] });
    }
    setNewWordInput('');
  };

  const handleRemoveWord = (word: string) => {
    setEdit({ highlight_words: edit.highlight_words.filter((w) => w !== word) });
  };

  // Upload Custom Font
  const handleUploadFontFile = async (file: File) => {
    setUploadingFont(true);
    try {
      const res = await uploadFont(file);
      setFonts([...fonts, res]);
      setEdit({ font_family: res.family });
      try {
        const styleEl = document.createElement('style');
        styleEl.textContent = `@font-face { font-family: "${res.family}"; src: url("${res.url}"); }`;
        document.head.appendChild(styleEl);
      } catch {
        // Fallback jika sudah ada
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingFont(false);
    }
  };

  const allFonts = [...DEFAULT_FONTS, ...fonts.map((f) => f.family)];
  const currentFontSize = edit.font_size ?? 75;

  return (
    <div
      className="w-full overflow-hidden"
      style={{
        width: 340,
        maxWidth: 340,
        background: '#F6F4F1',
        borderLeft: '1px solid #D3D9D6',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Sub-tab Navigation: (A) Subtitle Style vs (B) Video Framing */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          borderBottom: '1px solid #D3D9D6',
          background: '#EFF2F0',
        }}
      >
        <button
          onClick={() => setActiveSection('subtitle')}
          style={{
            padding: '12px 10px',
            background: activeSection === 'subtitle' ? '#F6F4F1' : 'transparent',
            color: activeSection === 'subtitle' ? '#1D634E' : '#5A635F',
            border: 'none',
            borderBottom: activeSection === 'subtitle' ? '2px solid #1D634E' : '2px solid transparent',
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
          <Icon icon="solar:palette-bold-duotone" width={15} height={15} />
          SUBTITLE STYLE
        </button>

        <button
          onClick={() => setActiveSection('framing')}
          style={{
            padding: '12px 10px',
            background: activeSection === 'framing' ? '#F6F4F1' : 'transparent',
            color: activeSection === 'framing' ? '#1D634E' : '#5A635F',
            border: 'none',
            borderBottom: activeSection === 'framing' ? '2px solid #1D634E' : '2px solid transparent',
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
          <Icon icon="solar:layers-bold-duotone" width={15} height={15} />
          VIDEO FRAMING
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-5 pb-6">
        {/* ================= SECTION A: SUBTITLE STYLE ================= */}
        {activeSection === 'subtitle' && (
          <>
            {/* Header AI Style Helper */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #D3D9D6' }}>
              <span style={{ fontSize: 11, color: '#5A635F', fontWeight: 600 }}>Pilih preset atau racik sendiri</span>
              <button
                onClick={handleSuggestStyle}
                disabled={loadingAiStyle}
                title="Rekomendasikan preset gaya dengan Gemini AI"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#1D634E',
                  color: '#F6F4F1',
                  fontSize: 10,
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {loadingAiStyle ? (
                  <Icon icon="solar:refresh-circle-bold-duotone" width={12} height={12} className="animate-spin" />
                ) : (
                  <Icon icon="solar:magic-stick-3-bold-duotone" width={12} height={12} />
                )}
                AI Rekomendasi
              </button>
            </div>

            {/* 1. Grid 4x2 Style Preset Cards */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 10,
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 800,
                  color: '#5A635F',
                  marginBottom: 8,
                  letterSpacing: '0.06em',
                }}
              >
                STYLE PRESETS
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                }}
              >
                {PRESET_CARDS.map((card) => {
                  const isSelected = edit.style_key === card.key;
                  return (
                    <div
                      key={card.key}
                      onClick={() => handleSelectPreset(card)}
                      style={{
                        background: isSelected ? 'rgba(29, 99, 78, 0.1)' : '#EFF2F0',
                        border: isSelected ? '1.5px solid #1D634E' : '1px solid #D3D9D6',
                        borderRadius: 8,
                        padding: '10px 8px',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        boxShadow: isSelected ? '0 2px 8px rgba(29, 99, 78, 0.2)' : 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        minHeight: 58,
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "'Montserrat', sans-serif",
                          fontWeight: 900,
                          fontSize: 11,
                          color: '#111916',
                          letterSpacing: '0.03em',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {card.titlePrefix}
                        {card.glowWord && (
                          <span
                            style={{
                              color: card.glowColor,
                            }}
                          >
                            {card.glowWord}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 9,
                          color: isSelected ? '#1D634E' : '#5A635F',
                          marginTop: 3,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {card.sub}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2. Font Family Selector */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 700,
                  color: '#5A635F',
                  marginBottom: 8,
                }}
              >
                // Font Family: <span style={{ color: '#1D634E' }}>{edit.font_family || 'Arial'}</span>
              </label>

              {/* Barisan tombol pill horizontal */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {allFonts.map((f) => {
                  const isSelected = edit.font_family === f;
                  return (
                    <button
                      key={f}
                      onClick={() => setEdit({ font_family: f })}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 6,
                        border: isSelected ? '1px solid #1D634E' : '1px solid #D3D9D6',
                        background: isSelected ? '#1D634E' : '#EFF2F0',
                        color: isSelected ? '#F6F4F1' : '#111916',
                        fontSize: 11,
                        fontFamily: f,
                        fontWeight: isSelected ? 800 : 500,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {f}
                    </button>
                  );
                })}
              </div>

              {/* Dropzone Upload Custom Font */}
              <div
                onClick={() => fontInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleUploadFontFile(f);
                }}
                style={{
                  border: '1.5px dashed #D3D9D6',
                  borderRadius: 8,
                  padding: '12px 14px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: '#EFF2F0',
                  transition: 'all 0.15s ease',
                }}
              >
                <input
                  ref={fontInputRef}
                  type="file"
                  accept=".ttf,.otf,.woff,.woff2"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadFontFile(f);
                  }}
                />
                {uploadingFont ? (
                  <Icon icon="solar:refresh-circle-bold-duotone" width={18} height={18} className="animate-spin" style={{ color: '#1D634E', margin: '0 auto 6px' }} />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#1D634E', marginBottom: 2 }}>
                    <Icon icon="solar:add-circle-bold-duotone" width={15} height={15} />
                    <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'Montserrat', sans-serif" }}>
                      Upload Custom Font (.ttf, .otf, .woff, .woff2)
                    </span>
                  </div>
                )}
                <div style={{ fontSize: 9, color: '#5A635F' }}>
                  Drag &amp; drop font file here or click to browse
                </div>
              </div>
            </div>

            {/* 3. Font Size Controls */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "'Montserrat', sans-serif",
                    fontWeight: 800,
                    color: '#5A635F',
                    letterSpacing: '0.06em',
                  }}
                >
                  FONT SIZE:
                </span>

                {/* Input numeric [ 75 ] px */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="number"
                    min={20}
                    max={150}
                    value={currentFontSize}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) setEdit({ font_size: val });
                    }}
                    style={{
                      width: 52,
                      background: '#EFF2F0',
                      border: '1px solid #D3D9D6',
                      borderRadius: 4,
                      padding: '3px 6px',
                      color: '#111916',
                      fontSize: 11,
                      fontFamily: "'JetBrains Mono', monospace",
                      textAlign: 'center',
                      outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: 11, color: '#5A635F' }}>px</span>
                </div>
              </div>

              {/* Barisan tombol preset Small (55px), Medium (75px), Big (95px), Custom */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {[
                  { label: 'Small', px: 55 },
                  { label: 'Medium', px: 75 },
                  { label: 'Big', px: 95 },
                  { label: 'Custom', px: null },
                ].map((p) => {
                  const isSelected = p.px ? currentFontSize === p.px : (currentFontSize !== 55 && currentFontSize !== 75 && currentFontSize !== 95);
                  return (
                    <button
                      key={p.label}
                      onClick={() => p.px && setEdit({ font_size: p.px })}
                      style={{
                        padding: '6px 4px',
                        borderRadius: 6,
                        border: isSelected ? '1px solid #1D634E' : '1px solid #D3D9D6',
                        background: isSelected ? '#1D634E' : '#EFF2F0',
                        color: isSelected ? '#F6F4F1' : '#5A635F',
                        fontSize: 10,
                        fontWeight: 700,
                        fontFamily: "'Montserrat', sans-serif",
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {p.label} {p.px ? `(${p.px}px)` : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4. Letter Style (Case Transform) */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 10,
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 800,
                  color: '#5A635F',
                  marginBottom: 8,
                  letterSpacing: '0.06em',
                }}
              >
                LETTER STYLE:
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {[
                  { key: 'uppercase' as LetterStyle, label: 'ABC (Caps)' },
                  { key: 'title' as LetterStyle, label: 'Abc (Title)' },
                  { key: 'lowercase' as LetterStyle, label: 'abc (Lower)' },
                ].map((btn) => {
                  const isSelected = (edit.letter_style ?? 'uppercase') === btn.key;
                  return (
                    <button
                      key={btn.key}
                      onClick={() => setEdit({ letter_style: btn.key })}
                      style={{
                        padding: '8px 4px',
                        borderRadius: 6,
                        border: isSelected ? '1px solid #1D634E' : '1px solid #D3D9D6',
                        background: isSelected ? '#1D634E' : '#EFF2F0',
                        color: isSelected ? '#F6F4F1' : '#5A635F',
                        fontSize: 11,
                        fontWeight: 800,
                        fontFamily: "'Montserrat', sans-serif",
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {btn.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 5. Subtitle Animation - Kinetic Word-by-Word Grid 2 Kolom */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <label
                  style={{
                    fontSize: 10,
                    fontFamily: "'Montserrat', sans-serif",
                    fontWeight: 800,
                    color: '#5A635F',
                    letterSpacing: '0.06em',
                  }}
                >
                  ANIMASI SUBTITLE KINETIC (PER KATA):
                </label>
                <span style={{ fontSize: 9, color: '#1D634E', fontFamily: "'Montserrat', sans-serif", fontWeight: 700 }}>
                  7 PRESET KINETIC
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {[
                  {
                    key: 'word_bounce' as SubtitleAnimation,
                    name: 'Hormozi Bounce',
                    badge: 'Viral',
                    desc: 'Memantul 128% & berubah warna saat giliran kata diucapkan',
                  },
                  {
                    key: 'karaoke_spotlight' as SubtitleAnimation,
                    name: 'Karaoke Spotlight',
                    badge: 'Trending',
                    desc: 'Kata redup menyala terang satu per satu mengikuti bicara',
                  },
                  {
                    key: 'spring_pop' as SubtitleAnimation,
                    name: 'Word Pop-In',
                    badge: 'Elastic',
                    desc: 'Kata muncul bertahap membal 0% -> 115% -> 100%',
                  },
                  {
                    key: 'blur_reveal' as SubtitleAnimation,
                    name: 'Blur Reveal',
                    badge: 'Cinematic',
                    desc: 'Muncul halus bertahap dari buram menjadi tajam',
                  },
                  {
                    key: 'impact_slam' as SubtitleAnimation,
                    name: 'Impact Slam',
                    badge: 'Punchy',
                    desc: 'Menghantam masuk dari skala 160% dengan transisi cepat 90ms',
                  },
                  {
                    key: 'neon_glow' as SubtitleAnimation,
                    name: 'Neon Glow Pulse',
                    badge: 'Glow',
                    desc: 'Kata aktif memancarkan aura outline neon tebal',
                  },
                  {
                    key: 'none' as SubtitleAnimation,
                    name: 'Static Clean',
                    badge: 'Static',
                    desc: 'Teks statis tanpa animasi gerak per kata',
                  },
                ].map((anim) => {
                  const isSelected = (edit.subtitle_animation ?? 'word_bounce') === anim.key;
                  return (
                    <button
                      key={anim.key}
                      onClick={() => setEdit({ subtitle_animation: anim.key })}
                      style={{
                        position: 'relative',
                        textAlign: 'left',
                        padding: '9px 10px',
                        borderRadius: 8,
                        border: isSelected ? '1.5px solid #1D634E' : '1px solid #D3D9D6',
                        background: isSelected ? 'rgba(29, 99, 78, 0.1)' : '#EFF2F0',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        boxShadow: isSelected ? '0 2px 8px rgba(29, 99, 78, 0.15)' : 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontFamily: "'Montserrat', sans-serif",
                            fontWeight: 800,
                            color: isSelected ? '#1D634E' : '#111916',
                          }}
                        >
                          {anim.name}
                        </span>
                        <span
                          style={{
                            fontSize: 8,
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 3,
                            background: isSelected ? '#1D634E' : '#D3D9D6',
                            color: isSelected ? '#F6F4F1' : '#5A635F',
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                          }}
                        >
                          {anim.badge}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: 9,
                          color: '#5A635F',
                          lineHeight: 1.35,
                        }}
                      >
                        {anim.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Warna & Margin Vertikal Subtitle */}
            <div>
              <label style={{ display: 'block', fontSize: 10, fontFamily: "'Montserrat', sans-serif", fontWeight: 800, color: '#5A635F', marginBottom: 8, letterSpacing: '0.06em' }}>
                CUSTOM COLOR &amp; POSITION
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                <div>
                  <span style={{ fontSize: 9, color: '#5A635F', display: 'block', marginBottom: 4 }}>Primary Color</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="color"
                      value={edit.primary_color || '#FFFF00'}
                      onChange={(e) => setEdit({ primary_color: e.target.value })}
                      style={{ width: 28, height: 28, borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer' }}
                    />
                    <input
                      type="text"
                      value={edit.primary_color || ''}
                      placeholder="#Auto"
                      onChange={(e) => setEdit({ primary_color: e.target.value })}
                      style={{ width: '100%', background: '#EFF2F0', border: '1px solid #D3D9D6', borderRadius: 4, padding: '3px 6px', color: '#111916', fontSize: 10, fontFamily: 'monospace' }}
                    />
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: 9, color: '#5A635F', display: 'block', marginBottom: 4 }}>Outline Color</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="color"
                      value={edit.outline_color || '#000000'}
                      onChange={(e) => setEdit({ outline_color: e.target.value })}
                      style={{ width: 28, height: 28, borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer' }}
                    />
                    <input
                      type="text"
                      value={edit.outline_color || ''}
                      placeholder="#Auto"
                      onChange={(e) => setEdit({ outline_color: e.target.value })}
                      style={{ width: '100%', background: '#EFF2F0', border: '1px solid #D3D9D6', borderRadius: 4, padding: '3px 6px', color: '#111916', fontSize: 10, fontFamily: 'monospace' }}
                    />
                  </div>
                </div>
              </div>

              {/* Posisi Vertikal */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#5A635F', marginBottom: 4 }}>
                <span>POSISI VERTIKAL (BOTTOM MARGIN)</span>
                <span style={{ color: '#1D634E', fontWeight: 700 }}>{edit.subtitle_margin_v ?? 340}px</span>
              </div>
              <input
                type="range"
                min={100}
                max={800}
                step={10}
                value={edit.subtitle_margin_v ?? 340}
                onChange={(e) => setEdit({ subtitle_margin_v: parseInt(e.target.value, 10) })}
                style={{ width: '100%' }}
              />
            </div>

            {/* Highlight Kata Kunci (AI + Manual) */}
            <div style={{ background: '#EFF2F0', padding: 12, borderRadius: 8, border: '1px solid #D3D9D6' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontFamily: "'Montserrat', sans-serif", fontWeight: 800, color: '#111916' }}>
                  HIGHLIGHT KATA KUNCI
                </span>
                <button
                  onClick={handleHighlightWords}
                  disabled={loadingAiWords}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#1D634E',
                    color: '#F6F4F1',
                    fontSize: 10,
                    fontFamily: "'Montserrat', sans-serif",
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {loadingAiWords ? (
                    <Icon icon="solar:refresh-circle-bold-duotone" width={11} height={11} className="animate-spin" />
                  ) : (
                    <Icon icon="solar:magic-stick-3-bold-duotone" width={11} height={11} />
                  )}
                  AI Highlight
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input
                  type="text"
                  placeholder="Tambah kata..."
                  value={newWordInput}
                  onChange={(e) => setNewWordInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddWord()}
                  style={{ flex: 1, background: '#F6F4F1', border: '1px solid #D3D9D6', borderRadius: 6, padding: '5px 8px', color: '#111916', fontSize: 11 }}
                />
                <button
                  onClick={handleAddWord}
                  style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: '#1D634E', color: '#F6F4F1', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}
                >
                  <Icon icon="solar:add-circle-bold-duotone" width={14} height={14} />
                </button>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 90, overflowY: 'auto' }}>
                {edit.highlight_words.map((w) => (
                  <span
                    key={w}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      padding: '3px 8px',
                      borderRadius: 4,
                      background: '#F6F4F1',
                      color: '#111916',
                      fontWeight: 700,
                      border: '1px solid #D3D9D6',
                    }}
                  >
                    {w}
                    <Icon icon="solar:close-circle-bold-duotone" width={12} height={12} style={{ cursor: 'pointer', color: '#B54329' }} onClick={() => handleRemoveWord(w)} />
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ================= SECTION B: VIDEO FRAMING ================= */}
        {activeSection === 'framing' && (
          <>
            <div>
              <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700, fontSize: 13, color: '#111916', marginBottom: 4 }}>
                Framing Video 9:16
              </div>
              <div style={{ fontSize: 11, color: '#5A635F', lineHeight: 1.5 }}>
                Atur tata letak video lanskap agar pas dan proporsional dalam format vertikal.
              </div>
            </div>

            {/* Pilihan Layout Mode */}
            <div>
              <label style={{ display: 'block', fontSize: 10, fontFamily: "'Montserrat', sans-serif", fontWeight: 800, color: '#5A635F', marginBottom: 8, letterSpacing: '0.06em' }}>
                MODE LAYOUT
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { mode: 'fill_crop' as LayoutMode, title: 'Fill & Crop', desc: 'Isi layar penuh 9:16' },
                  { mode: 'blur_bg' as LayoutMode, title: 'Blur Background', desc: 'Latar blur dinamis' },
                ].map((item) => {
                  const isActive = edit.layout_mode === item.mode;
                  return (
                    <button
                      key={item.mode}
                      onClick={() => setEdit({ layout_mode: item.mode })}
                      style={{
                        padding: '12px 10px',
                        borderRadius: 8,
                        border: isActive ? '1.5px solid #1D634E' : '1px solid #D3D9D6',
                        background: isActive ? 'rgba(29, 99, 78, 0.1)' : '#EFF2F0',
                        color: isActive ? '#1D634E' : '#111916',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 800 }}>{item.title}</div>
                      <div style={{ fontSize: 9, color: isActive ? '#1D634E' : '#5A635F', marginTop: 3 }}>{item.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {edit.layout_mode === 'fill_crop' ? (
              <div className="w-full flex flex-col gap-3">
                {/* Sub-tab Switcher: Posisi Statis vs Keyframe Kamera */}
                <div className="grid grid-cols-2 gap-2 w-full">
                  <button
                    type="button"
                    onClick={() => setFramingSubTab('static')}
                    className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                      framingSubTab === 'static'
                        ? 'bg-[#EFF2F0] border-[#1D634E] text-[#111916]'
                        : 'bg-[#F6F4F1] border-[#D3D9D6] text-[#5A635F] hover:border-[#1D634E]/50'
                    }`}
                  >
                    <div className="text-[11px] font-extrabold flex items-center gap-1.5">
                      <Icon
                        icon="solar:maximize-square-minimalistic-bold-duotone"
                        width={14}
                        height={14}
                        className={framingSubTab === 'static' ? 'text-[#1D634E]' : 'text-[#5A635F]'}
                      />
                      Posisi Statis
                    </div>
                    <div className={`text-[9px] mt-1 ${framingSubTab === 'static' ? 'text-[#1D634E]' : 'text-[#5A635F]'}`}>
                      X, Y &amp; Zoom tetap
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFramingSubTab('keyframes')}
                    className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                      framingSubTab === 'keyframes'
                        ? 'bg-[#EFF2F0] border-[#1D634E] text-[#111916]'
                        : 'bg-[#F6F4F1] border-[#D3D9D6] text-[#5A635F] hover:border-[#1D634E]/50'
                    }`}
                  >
                    <div className="text-[11px] font-extrabold flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Icon
                          icon="solar:camera-bold-duotone"
                          width={14}
                          height={14}
                          className={framingSubTab === 'keyframes' ? 'text-[#1D634E]' : 'text-[#5A635F]'}
                        />
                        Keyframe
                      </div>
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-[rgba(29,99,78,0.12)] text-[#1D634E]">
                        {edit.camera_keyframes?.length || 0} Titik
                      </span>
                    </div>
                    <div className={`text-[9px] mt-1 ${framingSubTab === 'keyframes' ? 'text-[#1D634E]' : 'text-[#5A635F]'}`}>
                      Pan &amp; zoom dinamis
                    </div>
                  </button>
                </div>

                {/* ================= SUB-TAB 1: POSISI STATIS ================= */}
                {framingSubTab === 'static' && (
                  <div className="w-full overflow-hidden flex flex-col gap-4 bg-[#EFF2F0] p-3.5 rounded-lg border border-[#D3D9D6]">
                    {/* Geser Horizontal */}
                    <div className="w-full flex flex-col gap-1">
                      <div className="flex justify-between items-center text-xs text-[#5A635F]">
                        <span className="font-bold text-[10px] tracking-wide">GESER HORIZONTAL (X OFFSET)</span>
                        <span className="text-[#1D634E] font-bold text-xs">{Math.round(edit.main_x_offset * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-2 w-full">
                        <span className="w-14 shrink-0 text-xs text-[#5A635F]">Posisi X</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={edit.main_x_offset}
                          onChange={(e) => updateMainFraming({ main_x_offset: parseFloat(e.target.value) })}
                          className="flex-1 min-w-0 accent-[#1D634E]"
                        />
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={Math.round(edit.main_x_offset * 100)}
                            onChange={(e) => {
                              const val = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
                              updateMainFraming({ main_x_offset: val / 100 });
                            }}
                            className="w-16 shrink-0 px-1.5 py-0.5 text-xs text-right tabular-nums bg-[#EFF2F0] border border-[#D3D9D6] rounded-md text-[#111916]"
                          />
                          <span className="text-xs text-[#5A635F]">%</span>
                        </div>
                      </div>
                      <div className="flex justify-between text-[10px] text-[#5A635F] pl-16 pr-8">
                        <span>Kiri</span>
                        <span>Tengah (50%)</span>
                        <span>Kanan</span>
                      </div>
                    </div>

                    {/* Geser Vertikal */}
                    <div className="w-full flex flex-col gap-1">
                      <div className="flex justify-between items-center text-xs text-[#5A635F]">
                        <span className="font-bold text-[10px] tracking-wide">GESER VERTIKAL (Y OFFSET)</span>
                        <span className="text-[#1D634E] font-bold text-xs">{Math.round(edit.main_y_offset * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-2 w-full">
                        <span className="w-14 shrink-0 text-xs text-[#5A635F]">Posisi Y</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={edit.main_y_offset}
                          onChange={(e) => updateMainFraming({ main_y_offset: parseFloat(e.target.value) })}
                          className="flex-1 min-w-0 accent-[#1D634E]"
                        />
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={Math.round(edit.main_y_offset * 100)}
                            onChange={(e) => {
                              const val = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
                              updateMainFraming({ main_y_offset: val / 100 });
                            }}
                            className="w-16 shrink-0 px-1.5 py-0.5 text-xs text-right tabular-nums bg-[#EFF2F0] border border-[#D3D9D6] rounded-md text-[#111916]"
                          />
                          <span className="text-xs text-[#5A635F]">%</span>
                        </div>
                      </div>
                      <div className="flex justify-between text-[10px] text-[#5A635F] pl-16 pr-8">
                        <span>Atas</span>
                        <span>Tengah (50%)</span>
                        <span>Bawah</span>
                      </div>
                    </div>

                    {/* Zoom Video Utama */}
                    <div className="w-full flex flex-col gap-1">
                      <div className="flex justify-between items-center text-xs text-[#5A635F]">
                        <span className="font-bold text-[10px] tracking-wide">ZOOM GAMEPLAY / VIDEO</span>
                        <span className="text-[#1D634E] font-bold text-xs">{edit.main_zoom.toFixed(2)}x</span>
                      </div>
                      <div className="flex items-center gap-2 w-full">
                        <span className="w-14 shrink-0 text-xs text-[#5A635F]">Zoom</span>
                        <input
                          type="range"
                          min={1.0}
                          max={3.0}
                          step={0.05}
                          value={edit.main_zoom}
                          onChange={(e) => updateMainFraming({ main_zoom: parseFloat(e.target.value) })}
                          className="flex-1 min-w-0 accent-[#1D634E]"
                        />
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            type="number"
                            min={1.0}
                            max={3.0}
                            step={0.05}
                            value={edit.main_zoom}
                            onChange={(e) => {
                              const val = Math.max(1.0, Math.min(3.0, parseFloat(e.target.value) || 1.0));
                              updateMainFraming({ main_zoom: parseFloat(val.toFixed(2)) });
                            }}
                            className="w-16 shrink-0 px-1.5 py-0.5 text-xs text-right tabular-nums bg-[#EFF2F0] border border-[#D3D9D6] rounded-md text-[#111916]"
                          />
                          <span className="text-xs text-[#5A635F]">x</span>
                        </div>
                      </div>
                    </div>

                    {/* Tombol Preset Cepat Framing */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => updateMainFraming({ main_x_offset: 0.5, main_y_offset: 0.5 })}
                        style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #D3D9D6', background: '#F6F4F1', color: '#111916', fontSize: 10, cursor: 'pointer' }}
                      >
                        Center 50%
                      </button>
                      <button
                        type="button"
                        onClick={() => updateMainFraming({ main_zoom: 1.0 })}
                        style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #D3D9D6', background: '#F6F4F1', color: '#111916', fontSize: 10, cursor: 'pointer' }}
                      >
                        Zoom 1.0x
                      </button>
                      <button
                        type="button"
                        onClick={() => updateMainFraming({ main_zoom: 1.25 })}
                        style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #D3D9D6', background: '#F6F4F1', color: '#111916', fontSize: 10, cursor: 'pointer' }}
                      >
                        Zoom 1.25x
                      </button>
                      <button
                        type="button"
                        onClick={() => updateMainFraming({ main_zoom: 1.5 })}
                        style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #D3D9D6', background: '#F6F4F1', color: '#111916', fontSize: 10, cursor: 'pointer' }}
                      >
                        Zoom 1.5x
                      </button>
                    </div>

                    {/* Reset Framing */}
                    <button
                      type="button"
                      onClick={() => setEdit({ main_x_offset: 0.5, main_y_offset: 0.5, main_zoom: 1.0 })}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        padding: '7px 12px',
                        borderRadius: 6,
                        border: '1px solid #D3D9D6',
                        background: 'transparent',
                        color: '#5A635F',
                        fontSize: 10,
                        cursor: 'pointer',
                        marginTop: 4,
                      }}
                    >
                      <Icon icon="solar:restart-bold-duotone" width={12} height={12} />
                      Reset Framing ke Default
                    </button>
                  </div>
                )}

                {/* ================= SUB-TAB 2: KEYFRAME KAMERA ================= */}
                {framingSubTab === 'keyframes' && (
                  <div className="w-full overflow-hidden flex flex-col gap-3.5 bg-[#EFF2F0] p-3.5 rounded-lg border border-[#D3D9D6]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Icon icon="solar:camera-bold-duotone" width={16} height={16} className="text-[#1D634E]" />
                        <span className="text-[11px] font-extrabold text-[#111916]">
                          KEYFRAME KAMERA (PAN &amp; ZOOM)
                        </span>
                      </div>
                      <span className="text-[10px] bg-[rgba(29,99,78,0.12)] text-[#1D634E] px-2 py-0.5 rounded font-bold">
                        {edit.camera_keyframes?.length || 0} Titik
                      </span>
                    </div>

                    <p className="text-[11px] text-[#5A635F] leading-relaxed m-0">
                      Buat pergerakan kamera dinamis (pan horizontal/vertikal &amp; zoom) yang berpindah mengikuti alur video.
                    </p>

                    {/* Tombol Utama CTA Tambah Keyframe */}
                    <button
                      type="button"
                      onClick={() => {
                        const targetTime = Math.max(0, Math.min(clipDuration, Number((previewTime || 0).toFixed(1))));
                        const newKf: CameraKeyframe = {
                          id: `kf_${Date.now()}`,
                          time: targetTime,
                          x_offset: edit.main_x_offset ?? 0.5,
                          y_offset: edit.main_y_offset ?? 0.5,
                          zoom: edit.main_zoom ?? 1.0,
                          easing: 'smooth',
                        };
                        const existing = (edit.camera_keyframes || []).filter((k) => Math.abs(k.time - targetTime) > 0.05);
                        const updated = [...existing, newKf].sort((a, b) => a.time - b.time);
                        setEdit({ camera_keyframes: updated });
                      }}
                      className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-[#1D634E] text-[#F6F4F1] text-xs font-bold hover:bg-[#16503e] transition-colors cursor-pointer border-none shadow-sm"
                    >
                      <Icon icon="solar:add-circle-bold-duotone" width={16} height={16} />
                      + Tambah Keyframe ({(previewTime || 0).toFixed(1)}s)
                    </button>

                    {/* Tombol Preset Pan Cepat: 3 Kolom */}
                    <div className="w-full flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-[#5A635F] tracking-wide">
                        PAN CEPAT KE PLAYHEAD ({(previewTime || 0).toFixed(1)}s)
                      </span>
                      <div className="grid grid-cols-3 gap-1.5 w-full">
                        <button
                          type="button"
                          onClick={() => handleQuickPanKeyframe(0.15)}
                          title="Setel atau tambah keyframe di sisi kiri (15%) pada detik ini"
                          className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md border border-[#D3D9D6] bg-[#F6F4F1] hover:bg-[#EFF2F0] text-[#111916] text-[11px] font-bold cursor-pointer transition-colors"
                        >
                          <Icon icon="solar:arrow-left-bold-duotone" width={13} height={13} className="text-[#1D634E]" />
                          Kiri (15%)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleQuickPanKeyframe(0.50)}
                          title="Setel atau tambah keyframe di posisi tengah (50%) pada detik ini"
                          className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md border border-[#D3D9D6] bg-[#F6F4F1] hover:bg-[#EFF2F0] text-[#111916] text-[11px] font-bold cursor-pointer transition-colors"
                        >
                          <Icon icon="solar:align-horizontal-center-bold-duotone" width={13} height={13} className="text-[#1D634E]" />
                          Tengah (50%)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleQuickPanKeyframe(0.85)}
                          title="Setel atau tambah keyframe di sisi kanan (85%) pada detik ini"
                          className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md border border-[#D3D9D6] bg-[#F6F4F1] hover:bg-[#EFF2F0] text-[#111916] text-[11px] font-bold cursor-pointer transition-colors"
                        >
                          <Icon icon="solar:arrow-right-bold-duotone" width={13} height={13} className="text-[#1D634E]" />
                          Kanan (85%)
                        </button>
                      </div>
                    </div>

                    {/* Preset Gerakan Kamera Otomatis */}
                    <div className="w-full flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-[#5A635F] tracking-wide">
                        PRESET GERAKAN LENGKAP
                      </span>
                      <div className="flex gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => {
                            const dur = clipDuration;
                            const kfs: CameraKeyframe[] = [
                              { id: `kf_${Date.now()}_1`, time: 0, x_offset: 0.15, y_offset: 0.5, zoom: 1.0, easing: 'smooth' },
                              { id: `kf_${Date.now()}_2`, time: parseFloat(dur.toFixed(2)), x_offset: 0.85, y_offset: 0.5, zoom: 1.0, easing: 'smooth' },
                            ];
                            setEdit({ camera_keyframes: kfs });
                          }}
                          title="Kamera bergeser mulus dari kiri ke kanan"
                          className="flex items-center gap-1 py-1.5 px-2.5 rounded-md border border-[#D3D9D6] bg-[#F6F4F1] hover:bg-[#EFF2F0] text-[#111916] text-[10px] font-bold cursor-pointer transition-colors"
                        >
                          <Icon icon="solar:arrow-right-bold-duotone" width={12} height={12} className="text-[#1D634E]" />
                          Pan Kiri ➔ Kanan
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const dur = clipDuration;
                            const kfs: CameraKeyframe[] = [
                              { id: `kf_${Date.now()}_1`, time: 0, x_offset: 0.85, y_offset: 0.5, zoom: 1.0, easing: 'smooth' },
                              { id: `kf_${Date.now()}_2`, time: parseFloat(dur.toFixed(2)), x_offset: 0.15, y_offset: 0.5, zoom: 1.0, easing: 'smooth' },
                            ];
                            setEdit({ camera_keyframes: kfs });
                          }}
                          title="Kamera bergeser mulus dari kanan ke kiri"
                          className="flex items-center gap-1 py-1.5 px-2.5 rounded-md border border-[#D3D9D6] bg-[#F6F4F1] hover:bg-[#EFF2F0] text-[#111916] text-[10px] font-bold cursor-pointer transition-colors"
                        >
                          <Icon icon="solar:arrow-left-bold-duotone" width={12} height={12} className="text-[#1D634E]" />
                          Pan Kanan ➔ Kiri
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const dur = clipDuration;
                            const mid = parseFloat((dur / 2).toFixed(2));
                            const kfs: CameraKeyframe[] = [
                              { id: `kf_${Date.now()}_1`, time: 0, x_offset: 0.5, y_offset: 0.5, zoom: 1.0, easing: 'smooth' },
                              { id: `kf_${Date.now()}_2`, time: mid, x_offset: 0.5, y_offset: 0.5, zoom: 1.45, easing: 'smooth' },
                              { id: `kf_${Date.now()}_3`, time: parseFloat(dur.toFixed(2)), x_offset: 0.5, y_offset: 0.5, zoom: 1.0, easing: 'smooth' },
                            ];
                            setEdit({ camera_keyframes: kfs });
                          }}
                          title="Zoom masuk dramatis di tengah klip lalu zoom out"
                          className="flex items-center gap-1 py-1.5 px-2.5 rounded-md border border-[#D3D9D6] bg-[#F6F4F1] hover:bg-[#EFF2F0] text-[#111916] text-[10px] font-bold cursor-pointer transition-colors"
                        >
                          <Icon icon="solar:magnifer-zoom-in-bold-duotone" width={12} height={12} className="text-[#1D634E]" />
                          Punch Zoom In
                        </button>
                      </div>
                    </div>

                    {/* List / Empty State Keyframe */}
                    {(!edit.camera_keyframes || edit.camera_keyframes.length === 0) ? (
                      <div className="flex flex-col items-center justify-center p-4 rounded-lg border border-dashed border-[#D3D9D6] bg-[#F6F4F1] text-center gap-2 mt-1">
                        <div className="w-8 h-8 rounded-full bg-[rgba(29,99,78,0.1)] flex items-center justify-center text-[#1D634E]">
                          <Icon icon="solar:camera-bold-duotone" width={18} height={18} />
                        </div>
                        <div className="text-xs font-bold text-[#111916]">Belum Ada Keyframe Kamera</div>
                        <p className="text-[11px] text-[#5A635F] max-w-xs leading-relaxed m-0">
                          Klik tombol <strong className="text-[#1D634E]">+ Tambah Keyframe</strong> atau gunakan tombol preset <strong className="text-[#1D634E]">Pan Cepat (Kiri, Tengah, Kanan)</strong> di atas untuk mengarahkan kamera mengikuti objek.
                        </p>
                      </div>
                    ) : (
                      <div className="w-full overflow-hidden flex flex-col gap-2 mt-1">
                        <div className="flex items-center justify-between px-0.5">
                          <span className="text-[10px] font-bold text-[#5A635F] tracking-wide">
                            DAFTAR TITIK KEYFRAME
                          </span>
                          <button
                            type="button"
                            onClick={() => setEdit({ camera_keyframes: [] })}
                            title="Hapus semua keyframe"
                            className="flex items-center gap-1 text-[11px] font-bold text-[#B54329] hover:bg-[rgba(181,67,41,0.1)] px-2 py-0.5 rounded cursor-pointer transition-colors border-none bg-transparent"
                          >
                            <Icon icon="solar:trash-bin-trash-bold-duotone" width={13} height={13} />
                            Hapus Semua
                          </button>
                        </div>

                        {edit.camera_keyframes.map((kf, idx) => {
                          const updateKf = (patch: Partial<CameraKeyframe>) => {
                            const next = (edit.camera_keyframes || [])
                              .map((k) => (k.id === kf.id ? { ...k, ...patch } : k))
                              .sort((a, b) => a.time - b.time);
                            setEdit({ camera_keyframes: next });
                          };
                          const removeKf = () => {
                            const next = (edit.camera_keyframes || []).filter((k) => k.id !== kf.id);
                            setEdit({ camera_keyframes: next });
                          };

                          const isCurrentActive = Math.abs(kf.time - (previewTime || 0)) <= 0.15;

                          return (
                            <div
                              key={kf.id}
                              className={`w-full overflow-hidden flex flex-col gap-2.5 p-2.5 rounded-lg border transition-all ${
                                isCurrentActive
                                  ? 'bg-[#EFF2F0] border-[#1D634E] shadow-[0_0_0_1px_rgba(29,99,78,0.25)]'
                                  : 'bg-[#F6F4F1] border-[#D3D9D6]'
                              }`}
                            >
                              {/* Baris 1 (Header Keyframe) */}
                              <div className="flex flex-wrap items-center justify-between gap-1.5 w-full">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-extrabold text-[#1D634E] bg-[rgba(29,99,78,0.12)] px-1.5 py-0.5 rounded">
                                    #{idx + 1}
                                  </span>
                                  <input
                                    type="number"
                                    min={0}
                                    max={clipDuration}
                                    step={0.1}
                                    value={kf.time}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value);
                                      if (!isNaN(val)) {
                                        updateKf({ time: Math.max(0, Math.min(clipDuration, parseFloat(val.toFixed(2)))) });
                                      }
                                    }}
                                    onBlur={(e) => {
                                      const val = parseFloat(e.target.value) || 0;
                                      updateKf({ time: Math.max(0, Math.min(clipDuration, parseFloat(val.toFixed(2)))) });
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        (e.target as HTMLInputElement).blur();
                                      }
                                    }}
                                    className="w-14 px-1.5 py-0.5 text-xs tabular-nums bg-[#EFF2F0] border border-[#D3D9D6] rounded-md text-[#111916] font-semibold"
                                  />
                                  <span className="text-xs text-[#5A635F]">s</span>
                                </div>

                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => requestSeek(kf.time)}
                                    title="Lompat ke detik ini"
                                    className="p-1 rounded bg-[#EFF2F0] border border-[#D3D9D6] text-[#1D634E] hover:bg-[#D3D9D6] transition-colors cursor-pointer flex items-center justify-center"
                                  >
                                    <Icon icon="solar:play-bold-duotone" width={12} height={12} />
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => updateKf({ easing: kf.easing === 'smooth' ? 'hold' : 'smooth' })}
                                    title={kf.easing === 'smooth' ? 'Pan mulus (interpolasi)' : 'Jump cut instan'}
                                    className={`px-2 py-0.5 text-[11px] font-bold rounded-md border cursor-pointer transition-colors ${
                                      kf.easing === 'smooth'
                                        ? 'bg-[rgba(29,99,78,0.12)] border-[#1D634E] text-[#1D634E]'
                                        : 'bg-[#EFF2F0] border-[#D3D9D6] text-[#5A635F]'
                                    }`}
                                  >
                                    {kf.easing === 'smooth' ? 'Smooth' : 'Cut'}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={removeKf}
                                    title="Hapus keyframe ini"
                                    className="p-1 text-[#B54329] hover:bg-[rgba(181,67,41,0.1)] rounded cursor-pointer transition-colors flex items-center justify-center border-none bg-transparent"
                                  >
                                    <Icon icon="solar:trash-bin-trash-bold-duotone" width={14} height={14} />
                                  </button>
                                </div>
                              </div>

                              {/* Baris 2 (Kontrol Posisi X, Posisi Y, Zoom) */}
                              <div className="flex flex-col gap-2 w-full">
                                {/* Posisi X */}
                                <div className="flex items-center gap-2 w-full">
                                  <span className="w-14 shrink-0 text-xs text-[#5A635F]">Posisi X</span>
                                  <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={kf.x_offset}
                                    onChange={(e) => updateKf({ x_offset: parseFloat(e.target.value) })}
                                    className="flex-1 min-w-0 accent-[#1D634E]"
                                  />
                                  <div className="flex items-center gap-1 shrink-0">
                                    <input
                                      type="number"
                                      min={0}
                                      max={100}
                                      step={1}
                                      value={Math.round(kf.x_offset * 100)}
                                      onChange={(e) => {
                                        const val = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
                                        updateKf({ x_offset: val / 100 });
                                      }}
                                      className="w-16 shrink-0 px-1.5 py-0.5 text-xs text-right tabular-nums bg-[#EFF2F0] border border-[#D3D9D6] rounded-md text-[#111916]"
                                    />
                                    <span className="text-xs text-[#5A635F]">%</span>
                                  </div>
                                </div>

                                {/* Posisi Y */}
                                <div className="flex items-center gap-2 w-full">
                                  <span className="w-14 shrink-0 text-xs text-[#5A635F]">Posisi Y</span>
                                  <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={kf.y_offset}
                                    onChange={(e) => updateKf({ y_offset: parseFloat(e.target.value) })}
                                    className="flex-1 min-w-0 accent-[#1D634E]"
                                  />
                                  <div className="flex items-center gap-1 shrink-0">
                                    <input
                                      type="number"
                                      min={0}
                                      max={100}
                                      step={1}
                                      value={Math.round(kf.y_offset * 100)}
                                      onChange={(e) => {
                                        const val = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
                                        updateKf({ y_offset: val / 100 });
                                      }}
                                      className="w-16 shrink-0 px-1.5 py-0.5 text-xs text-right tabular-nums bg-[#EFF2F0] border border-[#D3D9D6] rounded-md text-[#111916]"
                                    />
                                    <span className="text-xs text-[#5A635F]">%</span>
                                  </div>
                                </div>

                                {/* Zoom */}
                                <div className="flex items-center gap-2 w-full">
                                  <span className="w-14 shrink-0 text-xs text-[#5A635F]">Zoom</span>
                                  <input
                                    type="range"
                                    min={1.0}
                                    max={3.0}
                                    step={0.05}
                                    value={kf.zoom}
                                    onChange={(e) => updateKf({ zoom: parseFloat(e.target.value) })}
                                    className="flex-1 min-w-0 accent-[#1D634E]"
                                  />
                                  <div className="flex items-center gap-1 shrink-0">
                                    <input
                                      type="number"
                                      min={1.0}
                                      max={3.0}
                                      step={0.05}
                                      value={kf.zoom}
                                      onChange={(e) => {
                                        const val = Math.max(1.0, Math.min(3.0, parseFloat(e.target.value) || 1.0));
                                        updateKf({ zoom: parseFloat(val.toFixed(2)) });
                                      }}
                                      className="w-16 shrink-0 px-1.5 py-0.5 text-xs text-right tabular-nums bg-[#EFF2F0] border border-[#D3D9D6] rounded-md text-[#111916]"
                                    />
                                    <span className="text-xs text-[#5A635F]">x</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ background: '#EFF2F0', padding: 14, borderRadius: 8, border: '1px solid #D3D9D6', color: '#5A635F', fontSize: 11, lineHeight: 1.6 }}>
                💡 Mode <strong>Blur Background</strong> akan menampilkan seluruh frame video 16:9 secara utuh di tengah layar, dan mengisi ruang atas/bawah dengan efek latar buram (blur) dari video itu sendiri.
              </div>
            )}
          </>
        )}

        {/* Tombol Lanjut ke Tahap 4 */}
        <button
          onClick={() => setStep(4)}
          style={{
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
            fontSize: 12,
            cursor: 'pointer',
            letterSpacing: '0.04em',
            boxShadow: '0 2px 10px rgba(29, 99, 78, 0.25)',
            marginTop: 'auto',
          }}
        >
          FINAL PREVIEW &amp; EXPORT
          <Icon icon="solar:arrow-right-bold-duotone" width={16} height={16} />
        </button>
      </div>
    </div>
  );
}
