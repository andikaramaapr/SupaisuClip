import { useEffect } from 'react';
import { Icon } from '@iconify/react';
import { useStore } from './store';
import { fetchAssets } from './api';
import Logo from './components/Logo';
import SourceStep from './components/SourceStep';
import AnalyzeStep from './components/AnalyzeStep';
import EditStep from './components/EditStep';
import ExportStep from './components/ExportStep';
import type { Step } from './types';

const STEPS: Array<{ num: Step; label: string; icon: string }> = [
  { num: 1, label: 'Source', icon: 'solar:clapperboard-play-bold-duotone' },
  { num: 2, label: 'Analyze', icon: 'solar:magnifer-bold-duotone' },
  { num: 3, label: 'Edit', icon: 'solar:pen-new-square-bold-duotone' },
  { num: 4, label: 'Export', icon: 'solar:upload-bold-duotone' },
];

function FloatingDock({
  current,
  onSelect,
}: {
  current: Step;
  onSelect: (s: Step) => void;
}) {
  return (
    <nav
      aria-label="Navigation Steps"
      className="fixed left-5 top-1/2 -translate-y-1/2 z-50 rounded-full bg-[#1D634E] p-2 flex flex-col items-center gap-3 shadow-lg"
    >
      {/* Brand Badge */}
      <div
        className="bg-black/20 w-11 h-11 rounded-full flex items-center justify-center text-[#F6F4F1]"
        title="SupaisuClip"
      >
        <Logo className="w-5 h-6 text-[#F6F4F1]" />
      </div>

      {/* Step Buttons */}
      {STEPS.map((step) => {
        const isActive = step.num === current;
        return (
          <button
            key={step.num}
            onClick={() => onSelect(step.num)}
            title={`Step ${step.num}: ${step.label}`}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer ${
              isActive
                ? 'bg-[#F6F4F1] text-[#1D634E] shadow-sm'
                : 'text-[#F6F4F1]/50 hover:text-[#F6F4F1] hover:bg-black/10'
            }`}
          >
            <Icon icon={step.icon} width="22" height="22" />
          </button>
        );
      })}
    </nav>
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
          fontFace
            .load()
            .then((loaded) =>
              (document.fonts as unknown as { add: (f: FontFace) => void }).add(loaded)
            )
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [setFonts, setSfxList, setStyles]);

  return (
    <div className="min-h-screen bg-[#F6F4F1] text-[#111916] flex flex-col antialiased selection:bg-[#1D634E]/15 selection:text-[#1D634E]">
      {/* Header Atas Centered (h-14) */}
      <header className="h-14 border-b border-[#D3D9D6] bg-[#F6F4F1]/90 backdrop-blur-md sticky top-0 z-40 flex items-center justify-center px-6">
        <div className="flex items-center gap-2.5">
          <Logo className="w-5 h-6 text-[#1D634E]" />
          <span className="font-['Montserrat'] font-black text-base tracking-tight text-[#111916]">
            SupaisuClip
          </span>
        </div>
      </header>

      {/* Floating Left Capsule Dock */}
      <FloatingDock current={step} onSelect={setStep} />

      {/* Main Content Area */}
      <main
        className={`flex-1 w-full pl-24 pr-6 sm:pr-8 py-6 transition-all ${
          step === 3 ? 'max-w-none' : 'max-w-6xl mx-auto'
        }`}
      >
        <StepContent step={step} />
      </main>
    </div>
  );
}
