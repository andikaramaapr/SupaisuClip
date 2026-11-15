import { useEffect } from 'react';
import { useStore } from './store';
import { fetchAssets } from './api';
import SourceStep from './components/SourceStep';
import AnalyzeStep from './components/AnalyzeStep';
import EditStep from './components/EditStep';
import ExportStep from './components/ExportStep';
import type { Step } from './types';

const STEPS: Array<{ num: Step; label: string }> = [
  { num: 1, label: 'SOURCE' },
  { num: 2, label: 'ANALISIS' },
  { num: 3, label: 'EDIT' },
  { num: 4, label: 'EXPORT' },
];

function Stepper({
  current,
  onSelect,
}: {
  current: Step;
  onSelect: (s: Step) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 28px',
        height: 60,
        background: '#0B0B10',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        zIndex: 50,
      }}
    >
      {/* Brand Logo */}
      <div
        style={{
          fontFamily: "'Montserrat', sans-serif",
          fontWeight: 900,
          fontSize: 16,
          letterSpacing: '0.04em',
          marginRight: 40,
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <img
          src="/logo.png"
          alt="SupaisuClip Logo"
          style={{ width: 30, height: 30, objectFit: 'contain' }}
        />
        <span style={{ color: '#FFFFFF' }}>
          Supaisu<span style={{ color: '#C6FF3D' }}>Clip</span>
        </span>
      </div>

      {/* Stepper items */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {STEPS.map((step, idx) => {
          const isActive = step.num === current;
          const isDone = step.num < current;
          return (
            <div key={step.num} style={{ display: 'flex', alignItems: 'center' }}>
              {idx > 0 && (
                <div
                  style={{
                    width: 36,
                    height: 1,
                    background: isDone ? '#C6FF3D' : 'rgba(255,255,255,0.12)',
                    transition: 'background 0.2s',
                  }}
                />
              )}
              <button
                onClick={() => onSelect(step.num)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '6px 12px',
                  borderRadius: 6,
                  outline: 'none',
                }}
              >
                {/* Step Circle */}
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 800,
                    fontFamily: "'Montserrat', sans-serif",
                    transition: 'all 0.2s',
                    background: isDone
                      ? '#C6FF3D'
                      : isActive
                      ? 'rgba(198,255,61,0.18)'
                      : 'rgba(255,255,255,0.06)',
                    color: isDone
                      ? '#0B0B10'
                      : isActive
                      ? '#C6FF3D'
                      : '#4A4A5A',
                    border: isActive
                      ? '1.5px solid #C6FF3D'
                      : isDone
                      ? '1.5px solid #C6FF3D'
                      : '1.5px solid rgba(255,255,255,0.12)',
                  }}
                >
                  {isDone ? '✓' : step.num}
                </div>
                {/* Step Label */}
                <span
                  style={{
                    fontFamily: "'Montserrat', sans-serif",
                    fontWeight: isActive ? 800 : 600,
                    fontSize: 11,
                    letterSpacing: '0.08em',
                    color: isActive ? '#E8E8F0' : isDone ? '#C6FF3D' : '#4A4A5A',
                    transition: 'color 0.2s',
                  }}
                >
                  {step.label}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepContent({ step }: { step: Step }) {
  switch (step) {
    case 1:
      return <SourceStep />;
    case 2:
      return <AnalyzeStep />;
    case 3:
      return <EditStep />;
    case 4:
      return <ExportStep />;
    default:
      return <SourceStep />;
  }
}

export default function App() {
  const step = useStore((s) => s.step);
  const setStep = useStore((s) => s.setStep);
  const setFonts = useStore((s) => s.setFonts);
  const setSfxList = useStore((s) => s.setSfxList);
  const setStyles = useStore((s) => s.setStyles);

  // Muat aset default dari backend pada mount
  useEffect(() => {
    fetchAssets()
      .then((data) => {
        if (data.fonts) setFonts(data.fonts);
        if (data.sfx) setSfxList(data.sfx);
        if (data.styles) setStyles(data.styles);

        // Load custom fonts dynamically into document.fonts
        for (const f of data.fonts || []) {
          const fontFace = new FontFace(f.family, `url(${f.url})`);
          fontFace.load().then((loaded) => (document.fonts as unknown as { add: (f: FontFace) => void }).add(loaded)).catch(() => {});
        }
      })
      .catch(() => {});
  }, [setFonts, setSfxList, setStyles]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0B0B10',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Stepper current={step} onSelect={setStep} />

      <main
        style={{
          flex: 1,
          padding: step === 3 ? '16px' : '28px 32px',
          maxWidth: step === 3 ? '100%' : 1280,
          margin: '0 auto',
          width: '100%',
        }}
      >
        <StepContent step={step} />
      </main>
    </div>
  );
}
