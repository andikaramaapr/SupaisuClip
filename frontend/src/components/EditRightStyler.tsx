import { useState, useRef } from 'react';
import { Icon } from '@iconify/react';
import { useStore } from '../store';
import { highlightWords, suggestStyle, uploadFont } from '../api';
import type { StyleKey, LetterStyle, SubtitleAnimation, LayoutMode } from '../types';

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
  const { edit, setEdit, fonts, setFonts, setStep } = useStore();

  const [activeSection, setActiveSection] = useState<'subtitle' | 'framing'>('subtitle');
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
      style={{
        width: 340,
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

      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, background: '#EFF2F0', padding: 14, borderRadius: 8, border: '1px solid #D3D9D6' }}>
                {/* Geser Horizontal */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#5A635F', marginBottom: 4 }}>
                    <span>GESER HORIZONTAL (X OFFSET)</span>
                    <span style={{ color: '#1D634E', fontWeight: 700 }}>{Math.round(edit.main_x_offset * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={edit.main_x_offset}
                    onChange={(e) => setEdit({ main_x_offset: parseFloat(e.target.value) })}
                    style={{ width: '100%' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#5A635F', marginTop: 2 }}>
                    <span>Kiri</span>
                    <span>Tengah (50%)</span>
                    <span>Kanan</span>
                  </div>
                </div>

                {/* Geser Vertikal */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#5A635F', marginBottom: 4 }}>
                    <span>GESER VERTIKAL (Y OFFSET)</span>
                    <span style={{ color: '#1D634E', fontWeight: 700 }}>{Math.round(edit.main_y_offset * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={edit.main_y_offset}
                    onChange={(e) => setEdit({ main_y_offset: parseFloat(e.target.value) })}
                    style={{ width: '100%' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#5A635F', marginTop: 2 }}>
                    <span>Atas</span>
                    <span>Tengah (50%)</span>
                    <span>Bawah</span>
                  </div>
                </div>

                {/* Zoom Video Utama */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#5A635F', marginBottom: 4 }}>
                    <span>ZOOM GAMEPLAY / VIDEO</span>
                    <span style={{ color: '#1D634E', fontWeight: 700 }}>{edit.main_zoom.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min={1.0}
                    max={3.0}
                    step={0.05}
                    value={edit.main_zoom}
                    onChange={(e) => setEdit({ main_zoom: parseFloat(e.target.value) })}
                    style={{ width: '100%' }}
                  />
                </div>

                {/* Tombol Preset Cepat Framing */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setEdit({ main_x_offset: 0.5, main_y_offset: 0.5 })}
                    style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #D3D9D6', background: '#F6F4F1', color: '#111916', fontSize: 10, cursor: 'pointer' }}
                  >
                    Center 50%
                  </button>
                  <button
                    onClick={() => setEdit({ main_zoom: 1.0 })}
                    style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #D3D9D6', background: '#F6F4F1', color: '#111916', fontSize: 10, cursor: 'pointer' }}
                  >
                    Zoom 1.0x
                  </button>
                  <button
                    onClick={() => setEdit({ main_zoom: 1.25 })}
                    style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #D3D9D6', background: '#F6F4F1', color: '#111916', fontSize: 10, cursor: 'pointer' }}
                  >
                    Zoom 1.25x
                  </button>
                  <button
                    onClick={() => setEdit({ main_zoom: 1.5 })}
                    style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #D3D9D6', background: '#F6F4F1', color: '#111916', fontSize: 10, cursor: 'pointer' }}
                  >
                    Zoom 1.5x
                  </button>
                </div>

                {/* Reset Framing */}
                <button
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
