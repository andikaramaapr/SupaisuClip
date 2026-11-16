import { useState, useRef, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { useStore } from '../store';
import { fetchYoutubeFrame } from '../api';
import type { Rect } from '../types';

const NATIVE_W = 1080;
const NATIVE_H = 1920;

// Subtitle parser sederhana untuk preview sync
function parseSrtForPreview(srtText: string) {
  const blocks = (srtText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split(/\n\s*\n/);
  const entries: Array<{ start: number; end: number; text: string }> = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const arrowLine = lines.find((l) => l.includes('-->'));
    if (!arrowLine) continue;

    const [a, b] = arrowLine.split('-->').map((s) => s.trim());
    const parseTs = (ts: string) => {
      const match = ts.match(/(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/);
      if (!match) return 0;
      const [, h, m, s, frac] = match;
      return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt(frac.padEnd(3, '0'), 10) / 1000;
    };

    const start = parseTs(a);
    const end = parseTs(b);
    const text = lines.slice(lines.indexOf(arrowLine) + 1).join('\n');
    if (end > start && text) {
      entries.push({ start, end, text });
    }
  }
  return entries;
}

// Helper wrap cue text for preview
function wrapCueTextPreview(text: string, maxLines = 2, maxChars = 26): string {
  const words = text.replace(/\n+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const lines: string[] = [];
  let cur = '';

  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if ((cur + ' ' + w).length <= maxChars) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);

  if (lines.length > maxLines) {
    const firstPart = lines.slice(0, maxLines - 1);
    const rest = lines.slice(maxLines - 1).join(' ');
    return [...firstPart, rest].join('\n');
  }
  return lines.join('\n');
}

// Helper extract YouTube ID from diverse formats
function extractYoutubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /youtube\.com\/v\/([A-Za-z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = (url || '').match(p);
    if (m) return m[1];
  }
  return null;
}

export default function EditCenterCanvas() {
  const { edit, setEdit, videoMeta, videoUrl, previewUrl, youtubeVideoId, youtubeUrl } = useStore();
  const effectiveYoutubeId =
    youtubeVideoId ||
    extractYoutubeId(edit.youtube_url || youtubeUrl || '');
  const videoSrc = previewUrl || videoUrl || (edit.video_filename ? `/files/uploads/${edit.video_filename}` : '');
  // YouTube IFrame mode: used when no local video file but YouTube URL/ID is known
  const isYoutubeMode = !videoSrc && Boolean(effectiveYoutubeId);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // For YouTube mode: track currentTime via postMessage polling
  const ytTimeRef = useRef<number>(edit.clip_start || 0);
  const ytPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const webcamCanvasRef = useRef<HTMLCanvasElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(edit.clip_start || 0);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [showGrid, setShowGrid] = useState(true);
  const [showSafeMargin, setShowSafeMargin] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const snapEnabledRef = useRef(snapEnabled);
  snapEnabledRef.current = snapEnabled;

  const [snapIndicators, setSnapIndicators] = useState({
    centerX: false,
    centerY: false,
    marginL: false,
    marginR: false,
    marginT: false,
    marginB: false,
  });

  const [zoomPreset, setZoomPreset] = useState<'fit' | number>('fit');
  const [ytFrameUrl, setYtFrameUrl] = useState<string | null>(null);

  // Ambil frame tengah video untuk framing webcam saat mode YouTube
  useEffect(() => {
    if (!isYoutubeMode || !effectiveYoutubeId) return;
    const url = edit.youtube_url || (youtubeUrl ? youtubeUrl : `https://www.youtube.com/watch?v=${effectiveYoutubeId}`);
    const midPoint = (edit.clip_start + (edit.clip_end ?? (edit.clip_start + 30))) / 2;
    fetchYoutubeFrame(url, midPoint)
      .then((res) => {
        if (res.frame_url) {
          setYtFrameUrl(res.frame_url);
        }
      })
      .catch(() => {
        setYtFrameUrl(`https://img.youtube.com/vi/${effectiveYoutubeId}/hqdefault.jpg`);
      });
  }, [isYoutubeMode, effectiveYoutubeId, edit.youtube_url, youtubeUrl, edit.clip_start, edit.clip_end]);

  // ResizeObserver untuk menyesuaikan skala transform canvas 1080x1920
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          w: entry.contentRect.width,
          h: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Hitung skala canvas agar fit di layar atau sesuai zoom manual
  const padding = 24;
  const availW = Math.max(100, containerSize.w - padding * 2);
  const availH = Math.max(100, containerSize.h - padding * 2);
  const autoFitScale = Math.min(availW / NATIVE_W, availH / NATIVE_H) || 0.32;
  const scale = zoomPreset === 'fit' ? autoFitScale : zoomPreset;

  // Video playback tracking (Video Lokal)
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const cur = videoRef.current.currentTime;
    setCurrentTime(cur);

    // Batasi dalam rentang klip (loop / pause saat sampai clip_end)
    const end = edit.clip_end ?? videoMeta?.duration ?? 999999;
    if (cur >= end) {
      videoRef.current.pause();
      setIsPlaying(false);
      videoRef.current.currentTime = edit.clip_start;
      setCurrentTime(edit.clip_start);
    }
  };

  const handleVideoLoaded = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = edit.clip_start;
      setCurrentTime(edit.clip_start);
    }
  };

  // YouTube IFrame helpers (postMessage API)
  const ytSendCmd = (func: string, args?: unknown[]) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args: args || [] }),
      '*'
    );
  };

  const handleIframeLoad = () => {
    ytSendCmd('seekTo', [edit.clip_start, true]);
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'listening' }), '*'
    );
  };

  // Otomatis sinkronkan waktu pemutar saat clip_start berubah atau berganti klip
  useEffect(() => {
    setCurrentTime(edit.clip_start);
    ytTimeRef.current = edit.clip_start;
    if (isYoutubeMode) {
      ytSendCmd('seekTo', [edit.clip_start, true]);
    } else if (videoRef.current) {
      videoRef.current.currentTime = edit.clip_start;
    }
  }, [edit.clip_start, isYoutubeMode]);

  // Poll YouTube currentTime every 250ms
  useEffect(() => {
    if (!isYoutubeMode) return;
    const handleMsg = (ev: MessageEvent) => {
      try {
        const data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
        if (data?.event === 'onReady') {
          ytSendCmd('seekTo', [edit.clip_start, true]);
        }
        if (data?.event === 'infoDelivery' && data?.info?.currentTime !== undefined) {
          const cur = data.info.currentTime as number;
          ytTimeRef.current = cur;
          setCurrentTime(cur);
          const end = edit.clip_end ?? videoMeta?.duration ?? 999999;
          if (cur >= end) {
            ytSendCmd('seekTo', [edit.clip_start, true]);
            ytSendCmd('pauseVideo');
            setIsPlaying(false);
          }
        }
      } catch { /* ignore */ }
    };
    window.addEventListener('message', handleMsg);
    // Start polling for time info every 250ms
    ytPollRef.current = setInterval(() => {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening' }), '*'
      );
    }, 250);
    return () => {
      window.removeEventListener('message', handleMsg);
      if (ytPollRef.current) clearInterval(ytPollRef.current);
    };
  }, [isYoutubeMode, edit.clip_end, edit.clip_start, videoMeta?.duration]);

  const togglePlay = () => {
    if (isYoutubeMode) {
      if (isPlaying) {
        ytSendCmd('pauseVideo');
        setIsPlaying(false);
      } else {
        const cur = ytTimeRef.current;
        if (cur < edit.clip_start || cur >= (edit.clip_end ?? 9999)) {
          ytSendCmd('seekTo', [edit.clip_start, true]);
        }
        ytSendCmd('playVideo');
        setIsPlaying(true);
      }
      return;
    }
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

  // Subtitle aktif
  const srtEntries = parseSrtForPreview(edit.srt_text);
  const relTime = edit.srt_relative ? currentTime - edit.clip_start : currentTime;
  // Apply subtitle_offset_sec: geser waktu pencarian subtitle (+ = subtitle tampil lebih lambat)
  const adjustedRelTime = Math.max(0, relTime - (edit.subtitle_offset_sec ?? 0));
  const rawSub = srtEntries.find((e) => adjustedRelTime >= e.start && adjustedRelTime <= e.end);

  // Apply letter_style transform for live preview
  const applyLetterStyle = (text: string) => {
    const ls = edit.letter_style ?? 'uppercase';
    if (ls === 'uppercase') return text.toUpperCase();
    if (ls === 'lowercase') return text.toLowerCase();
    // title: capitalize first letter of each word
    return text.replace(/\b\w/g, (c) => c.toUpperCase());
  };
  const activeSub = rawSub ? { ...rawSub, text: wrapCueTextPreview(applyLetterStyle(rawSub.text)) } : undefined;

  // Kinetic Word-by-Word Live Preview Renderer
  const renderKineticPreview = () => {
    if (!activeSub) return null;

    const anim = edit.subtitle_animation ?? 'word_bounce';
    const baseColor = edit.primary_color || (edit.style_key === 'hormozi_pop' ? '#FFFF00' : '#FFFFFF');
    const highlightColor = edit.highlight_color || '#FF3B3B';
    const hlWords = (edit.highlight_words || []).map((w) => w.trim().toLowerCase()).filter(Boolean);

    if (anim === 'none') {
      return activeSub.text;
    }

    const lines = activeSub.text.split('\n');
    const allWords = lines.flatMap((l) => l.split(/\s+/).filter(Boolean));
    const numWords = allWords.length;
    if (numWords === 0) return activeSub.text;

    const cueDur = Math.max(0.2, activeSub.end - activeSub.start);
    const elapsed = Math.max(0, adjustedRelTime - activeSub.start);
    const totalChars = allWords.reduce((sum, w) => sum + w.length, 0) || 1;
    const minWordSec = 0.08;

    let wordDurs: number[];
    if (cueDur <= numWords * minWordSec) {
      wordDurs = Array(numWords).fill(cueDur / numWords);
    } else {
      const rem = cueDur - numWords * minWordSec;
      wordDurs = allWords.map((w) => minWordSec + rem * (w.length / totalChars));
    }

    let curT = 0;
    const wordTimings = wordDurs.map((d) => {
      const s = curT;
      const e = curT + d;
      curT += d;
      return { s, e };
    });

    let wordIdx = 0;
    return (
      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        {lines.map((line, lIdx) => {
          const wordsInLine = line.split(/\s+/).filter(Boolean);
          return (
            <div key={lIdx} style={{ display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.28em' }}>
              {wordsInLine.map((w, wInLineIdx) => {
                const timing = wordTimings[wordIdx] || { s: 0, e: cueDur };
                wordIdx++;

                const isCurrent = elapsed >= timing.s && elapsed < timing.e;
                const isUpcoming = elapsed < timing.s;
                const cleanWord = w.replace(/[^\w]/g, '').toLowerCase();
                const isKeyword = hlWords.some((hw) => cleanWord.includes(hw));

                let wColor = isKeyword ? highlightColor : baseColor;
                let wTransform = 'scale(1)';
                let wOpacity = 1;
                let wFilter = 'none';
                let wShadow = 'none';

                if (anim === 'word_bounce' || anim === 'zoom_soft') {
                  if (isCurrent) {
                    wColor = highlightColor;
                    wTransform = 'scale(1.28)';
                    wShadow = `0 0 16px ${highlightColor}`;
                  }
                } else if (anim === 'karaoke_spotlight') {
                  if (isUpcoming) {
                    wOpacity = 0.35;
                  } else if (isCurrent) {
                    wColor = highlightColor;
                    wTransform = 'scale(1.08)';
                    wOpacity = 1;
                  } else {
                    wOpacity = 1;
                  }
                } else if (anim === 'spring_pop' || anim === 'pop_in') {
                  if (isUpcoming) {
                    wOpacity = 0;
                    wTransform = 'scale(0)';
                  } else if (isCurrent) {
                    wColor = highlightColor;
                    wTransform = 'scale(1.15)';
                    wOpacity = 1;
                  }
                } else if (anim === 'blur_reveal' || anim === 'fade_up') {
                  if (isUpcoming) {
                    wOpacity = 0;
                    wFilter = 'blur(10px)';
                    wTransform = 'scale(1.08)';
                  } else if (isCurrent) {
                    wColor = highlightColor;
                    wFilter = 'blur(0)';
                    wTransform = 'scale(1.0)';
                  }
                } else if (anim === 'impact_slam') {
                  if (isUpcoming) {
                    wOpacity = 0;
                    wTransform = 'scale(1.6)';
                  } else if (isCurrent) {
                    wColor = highlightColor;
                    wTransform = 'scale(1.0)';
                  }
                } else if (anim === 'neon_glow') {
                  if (isCurrent) {
                    wColor = highlightColor;
                    wTransform = 'scale(1.06)';
                    wShadow = `0 0 18px ${highlightColor}, 0 0 32px ${highlightColor}`;
                  }
                }

                return (
                  <span
                    key={`${lIdx}_${wInLineIdx}_${w}`}
                    style={{
                      display: 'inline-block',
                      color: wColor,
                      transform: wTransform,
                      opacity: wOpacity,
                      filter: wFilter,
                      textShadow: wShadow !== 'none' ? wShadow : undefined,
                      transition: 'transform 0.09s ease-out, opacity 0.08s ease-out, filter 0.1s ease-out, color 0.08s',
                      transformOrigin: 'center bottom',
                    }}
                  >
                    {w}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  // Apply hook_letter_style transform for live preview
  const applyHookLetterStyle = (text: string) => {
    const ls = edit.hook_letter_style ?? 'uppercase';
    if (ls === 'uppercase') return text.toUpperCase();
    if (ls === 'lowercase') return text.toLowerCase();
    return text.replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // Status tampil Hook
  const clipDuration = (edit.clip_end ?? videoMeta?.duration ?? 60) - edit.clip_start;
  const hookDuration = edit.hook_duration_sec <= 0 ? clipDuration : edit.hook_duration_sec;
  const showHook = Boolean(edit.hook_text.trim() && currentTime - edit.clip_start <= hookDuration);

  // Koordinat Webcam
  const currentDst: Rect = edit.webcam_dst || { x: 40, y: 80, w: 320, h: 320 };
  const currentSrc: Rect = edit.webcam_src || { x: 0.02, y: 0.65, w: 0.28, h: 0.32 };

  // -------------------------------------------------------------
  // Sinkronisasi Real-Time Webcam Crop ke Canvas via drawImage
  // -------------------------------------------------------------
  const drawWebcamFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = webcamCanvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const vw = video.videoWidth || 1920;
    const vh = video.videoHeight || 1080;
    const src = edit.webcam_src || { x: 0.02, y: 0.65, w: 0.28, h: 0.32 };

    const sx = Math.max(0, Math.min(vw, src.x * vw));
    const sy = Math.max(0, Math.min(vh, src.y * vh));
    const sw = Math.max(1, Math.min(vw - sx, src.w * vw));
    const sh = Math.max(1, Math.min(vh - sy, src.h * vh));

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  }, [edit.webcam_src]);

  useEffect(() => {
    if (!edit.webcam_enabled) return;
    let animId: number;

    const renderLoop = () => {
      drawWebcamFrame();
      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);

    const video = videoRef.current;
    if (video) {
      video.addEventListener('seeked', drawWebcamFrame);
      video.addEventListener('timeupdate', drawWebcamFrame);
      video.addEventListener('loadeddata', drawWebcamFrame);
    }

    return () => {
      cancelAnimationFrame(animId);
      if (video) {
        video.removeEventListener('seeked', drawWebcamFrame);
        video.removeEventListener('timeupdate', drawWebcamFrame);
        video.removeEventListener('loadeddata', drawWebcamFrame);
      }
    };
  }, [edit.webcam_enabled, drawWebcamFrame]);

  // -------------------------------------------------------------
  // Drag & Resize Handler untuk Webcam DST di Canvas 9:16 (1080x1920)
  // -------------------------------------------------------------
  const [draggingDst, setDraggingDst] = useState(false);
  const dragDstRef = useRef<{ mouseX: number; mouseY: number; rect: Rect }>({
    mouseX: 0,
    mouseY: 0,
    rect: { x: 40, y: 80, w: 320, h: 320 },
  });

  const handleDstMouseDown = (e: React.MouseEvent, handle?: string) => {
    e.stopPropagation();
    e.preventDefault();
    dragDstRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      rect: { ...currentDst },
    };

    if (!handle) setDraggingDst(true);

    const onMouseMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - dragDstRef.current.mouseX) / scale;
      const dy = (ev.clientY - dragDstRef.current.mouseY) / scale;
      const start = dragDstRef.current.rect;

      let snapCenterX = false;
      let snapCenterY = false;
      let snapMarginL = false;
      let snapMarginR = false;
      let snapMarginT = false;
      let snapMarginB = false;

      const isSnap = snapEnabledRef.current;
      // Ambang magnet THRESHOLD = 0.015 (1.5% ukuran kanvas)
      const threshX = NATIVE_W * 0.015; // 16.2px
      const threshY = NATIVE_H * 0.015; // 28.8px
      const centerPX = NATIVE_W / 2; // 540
      const centerPY = NATIVE_H / 2; // 960

      // Margin standar: L: 6%, R: 12%, T: 11%, B: 22%
      const marginL = Math.round(NATIVE_W * 0.06); // 65
      const marginR = Math.round(NATIVE_W * (1 - 0.12)); // 950
      const marginT = Math.round(NATIVE_H * 0.11); // 211
      const marginB = Math.round(NATIVE_H * (1 - 0.22)); // 1498

      if (!handle) {
        // Move
        let nx = Math.max(0, Math.min(NATIVE_W - start.w, start.x + dx));
        let ny = Math.max(0, Math.min(NATIVE_H - start.h, start.y + dy));

        if (isSnap) {
          // Snap horizontal center
          const curCenterX = nx + start.w / 2;
          if (Math.abs(curCenterX - centerPX) <= threshX) {
            nx = centerPX - start.w / 2;
            snapCenterX = true;
          } else if (Math.abs(nx - marginL) <= threshX) {
            nx = marginL;
            snapMarginL = true;
          } else if (Math.abs(nx + start.w - marginR) <= threshX) {
            nx = marginR - start.w;
            snapMarginR = true;
          }

          // Snap vertical center
          const curCenterY = ny + start.h / 2;
          if (Math.abs(curCenterY - centerPY) <= threshY) {
            ny = centerPY - start.h / 2;
            snapCenterY = true;
          } else if (Math.abs(ny - marginT) <= threshY) {
            ny = marginT;
            snapMarginT = true;
          } else if (Math.abs(ny + start.h - marginB) <= threshY) {
            ny = marginB - start.h;
            snapMarginB = true;
          }
        }

        setSnapIndicators({
          centerX: snapCenterX,
          centerY: snapCenterY,
          marginL: snapMarginL,
          marginR: snapMarginR,
          marginT: snapMarginT,
          marginB: snapMarginB,
        });

        setEdit({ webcam_dst: { x: Math.round(nx), y: Math.round(ny), w: start.w, h: start.h } });
      } else {
        // Resize
        let nw = start.w;
        let nh = start.h;
        let nx = start.x;
        let ny = start.y;

        if (handle.includes('e')) nw = Math.max(80, Math.min(NATIVE_W - start.x, start.w + dx));
        if (handle.includes('s')) nh = Math.max(80, Math.min(NATIVE_H - start.y, start.h + dy));
        if (handle.includes('w')) {
          const diff = Math.min(start.w - 80, dx);
          nx = start.x + diff;
          nw = start.w - diff;
        }
        if (handle.includes('n')) {
          const diff = Math.min(start.h - 80, dy);
          ny = start.y + diff;
          nh = start.h - diff;
        }

        if (isSnap) {
          if (handle.includes('e')) {
            if (Math.abs(nx + nw - marginR) <= threshX) {
              nw = marginR - nx;
              snapMarginR = true;
            } else if (Math.abs(nx + nw - centerPX) <= threshX) {
              nw = centerPX - nx;
              snapCenterX = true;
            }
          }
          if (handle.includes('w')) {
            if (Math.abs(nx - marginL) <= threshX) {
              const diffL = marginL - start.x;
              nx = marginL;
              nw = Math.max(80, start.w - diffL);
              snapMarginL = true;
            } else if (Math.abs(nx - centerPX) <= threshX) {
              const diffC = centerPX - start.x;
              nx = centerPX;
              nw = Math.max(80, start.w - diffC);
              snapCenterX = true;
            }
          }
          if (handle.includes('s')) {
            if (Math.abs(ny + nh - marginB) <= threshY) {
              nh = marginB - ny;
              snapMarginB = true;
            } else if (Math.abs(ny + nh - centerPY) <= threshY) {
              nh = centerPY - ny;
              snapCenterY = true;
            }
          }
          if (handle.includes('n')) {
            if (Math.abs(ny - marginT) <= threshY) {
              const diffT = marginT - start.y;
              ny = marginT;
              nh = Math.max(80, start.h - diffT);
              snapMarginT = true;
            } else if (Math.abs(ny - centerPY) <= threshY) {
              const diffC = centerPY - start.y;
              ny = centerPY;
              nh = Math.max(80, start.h - diffC);
              snapCenterY = true;
            }
          }
        }

        setSnapIndicators({
          centerX: snapCenterX,
          centerY: snapCenterY,
          marginL: snapMarginL,
          marginR: snapMarginR,
          marginT: snapMarginT,
          marginB: snapMarginB,
        });

        setEdit({
          webcam_dst: {
            x: Math.round(nx),
            y: Math.round(ny),
            w: Math.round(nw),
            h: Math.round(nh),
          },
        });
      }
    };

    const onMouseUp = () => {
      setDraggingDst(false);
      setSnapIndicators({
        centerX: false,
        centerY: false,
        marginL: false,
        marginR: false,
        marginT: false,
        marginB: false,
      });
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div
      style={{
        flex: 1,
        background: '#EFF2F0',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Zoom Control Bar & Safe Zone Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 18px',
          background: '#F6F4F1',
          borderBottom: '1px solid #D3D9D6',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        {/* Sisi Kiri: Alignment Tools (Grid +, Safe Margin, Snap) & Canvas Tag */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* Toggle Grid + */}
          <button
            onClick={() => setShowGrid((v) => !v)}
            title="Toggle Center Crosshair Grid (+)"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid ' + (showGrid ? '#1D634E' : '#D3D9D6'),
              background: showGrid ? 'rgba(29, 99, 78, 0.12)' : '#EFF2F0',
              color: showGrid ? '#1D634E' : '#5A635F',
              fontSize: 11,
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Icon icon="solar:crosshair-bold-duotone" width={14} height={14} />
            Grid +
          </button>

          {/* Toggle Safe Margin */}
          <button
            onClick={() => setShowSafeMargin((v) => !v)}
            title="Toggle Safe Margin Box (TikTok / Reels / Shorts)"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid ' + (showSafeMargin ? '#1D634E' : '#D3D9D6'),
              background: showSafeMargin ? 'rgba(29, 99, 78, 0.12)' : '#EFF2F0',
              color: showSafeMargin ? '#1D634E' : '#5A635F',
              fontSize: 11,
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Icon icon="solar:shield-check-bold-duotone" width={14} height={14} />
            Safe Margin
          </button>

          {/* Toggle Magnetic Snap */}
          <button
            onClick={() => setSnapEnabled((v) => !v)}
            title="Toggle Magnetic Snap saat drag / resize webcam"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid ' + (snapEnabled ? '#1D634E' : '#D3D9D6'),
              background: snapEnabled ? 'rgba(29, 99, 78, 0.12)' : '#EFF2F0',
              color: snapEnabled ? '#1D634E' : '#5A635F',
              fontSize: 11,
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Icon icon="solar:magnet-bold-duotone" width={14} height={14} />
            Snap
          </button>

          <span style={{ fontSize: 11, color: '#5A635F', fontFamily: "'JetBrains Mono', monospace", marginLeft: 4 }}>
            1080x1920 (9:16)
          </span>
        </div>

        {/* Sisi Kanan: Preset Zoom Buttons & Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ display: 'flex', background: '#EFF2F0', padding: 2, borderRadius: 6, border: '1px solid #D3D9D6' }}>
            <button
              onClick={() => setZoomPreset('fit')}
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                border: 'none',
                background: zoomPreset === 'fit' ? '#1D634E' : 'transparent',
                color: zoomPreset === 'fit' ? '#F6F4F1' : '#5A635F',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Icon icon="solar:maximize-square-bold-duotone" width={12} height={12} />
              Fit
            </button>
            {[0.5, 0.75, 1.0, 1.25].map((z) => {
              const isSelected = zoomPreset === z;
              return (
                <button
                  key={z}
                  onClick={() => setZoomPreset(z)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 4,
                    border: 'none',
                    background: isSelected ? '#1D634E' : 'transparent',
                    color: isSelected ? '#F6F4F1' : '#5A635F',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {Math.round(z * 100)}%
                </button>
              );
            })}
          </div>

          {/* Tombol - dan + */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: '#EFF2F0', padding: 2, borderRadius: 6, border: '1px solid #D3D9D6' }}>
            <button
              onClick={() => {
                const cur = typeof zoomPreset === 'number' ? zoomPreset : scale;
                setZoomPreset(Math.max(0.25, parseFloat((cur - 0.1).toFixed(2))));
              }}
              title="Zoom Out (-)"
              style={{ padding: '4px 6px', borderRadius: 4, border: 'none', background: 'transparent', color: '#111916', cursor: 'pointer' }}
            >
              <Icon icon="solar:magnifer-zoom-out-bold-duotone" width={14} height={14} />
            </button>
            <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: '#1D634E', minWidth: 36, textAlign: 'center', fontWeight: 700 }}>
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={() => {
                const cur = typeof zoomPreset === 'number' ? zoomPreset : scale;
                setZoomPreset(Math.min(2.0, parseFloat((cur + 0.1).toFixed(2))));
              }}
              title="Zoom In (+)"
              style={{ padding: '4px 6px', borderRadius: 4, border: 'none', background: 'transparent', color: '#111916', cursor: 'pointer' }}
            >
              <Icon icon="solar:magnifer-zoom-in-bold-duotone" width={14} height={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Area Tengah: Live Preview 9:16 Canvas Besar */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'auto',
          background: '#EFF2F0',
          padding: 24,
        }}
      >
        {/* Kontainer Canvas 1080x1920 dengan Transform CSS */}
        <div
          style={{
            position: 'relative',
            width: NATIVE_W,
            height: NATIVE_H,
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
            background: '#000000',
            boxShadow: '0 0 60px rgba(0,0,0,0.9)',
            borderRadius: 8,
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {/* Layer 0: Background Video OR YouTube IFrame */}
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 1, background: '#000000' }}>
            {isYoutubeMode ? (
              /* YouTube IFrame Player – controlled via postMessage YT API */
              <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
                {edit.layout_mode === 'blur_bg' && (
                  <iframe
                    src={`https://www.youtube.com/embed/${effectiveYoutubeId}?enablejsapi=0&controls=0&modestbranding=1&rel=0&playsinline=1&start=${Math.floor(edit.clip_start)}&autoplay=0&mute=1`}
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: '316.05%',
                      height: '100%',
                      transform: 'translate(-50%, -50%) scale(1.15)',
                      filter: 'blur(28px) brightness(0.45)',
                      border: 'none',
                      pointerEvents: 'none',
                    }}
                    tabIndex={-1}
                    title="YouTube Blur Background"
                  />
                )}
                <iframe
                  ref={iframeRef}
                  onLoad={handleIframeLoad}
                  src={`https://www.youtube.com/embed/${effectiveYoutubeId}?enablejsapi=1&controls=0&modestbranding=1&rel=0&playsinline=1&start=${Math.floor(edit.clip_start)}&autoplay=0`}
                  allow="autoplay; encrypted-media"
                  style={{
                    position: 'absolute',
                    border: 'none',
                    pointerEvents: 'none',
                    ...(edit.layout_mode === 'blur_bg'
                      ? {
                          left: 0,
                          top: '50%',
                          width: '100%',
                          height: 607.5,
                          transform: 'translateY(-50%)',
                        }
                      : {
                          left: '50%',
                          top: '50%',
                          width: '316.05%',
                          height: '100%',
                          transform: `translate(-50%, -50%) scale(${edit.main_zoom}) translate(${(0.5 - edit.main_x_offset) * 30}%, ${(0.5 - edit.main_y_offset) * 30}%)`,
                        }),
                  }}
                  title="YouTube Preview"
                />
              </div>
            ) : (
              <video
                ref={videoRef}
                src={videoSrc}
                onLoadedMetadata={handleVideoLoaded}
                onTimeUpdate={handleTimeUpdate}
                playsInline
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: edit.layout_mode === 'blur_bg' ? 'contain' : 'cover',
                  transform:
                    edit.layout_mode === 'fill_crop'
                      ? `scale(${edit.main_zoom}) translate(${(0.5 - edit.main_x_offset) * 30}%, ${(0.5 - edit.main_y_offset) * 30}%)`
                      : 'none',
                }}
              />
            )}
          </div>

          {/* Layer 1: Subtitle Preview (Kinetic Word-by-Word Animation) */}
          {activeSub && (
            <div
              key={`${activeSub.start}_${activeSub.text}`}
              style={{
                position: 'absolute',
                left: 60,
                right: 60,
                bottom: edit.subtitle_margin_v ?? 340,
                textAlign: 'center',
                color: edit.primary_color || (edit.style_key === 'hormozi_pop' ? '#FFFF00' : '#FFFFFF'),
                fontSize: `${edit.font_size ?? 68}px`,
                fontFamily: edit.font_family || 'Arial',
                fontWeight: 900,
                lineHeight: 1.25,
                textShadow: '0 4px 14px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,1)',
                WebkitTextStroke: edit.outline_color ? `4px ${edit.outline_color}` : '4px #000000',
                pointerEvents: 'none',
                zIndex: 10,
                whiteSpace: 'pre-wrap',
              }}
            >
              {renderKineticPreview()}
            </div>
          )}

          {/* Subtitle & Hook Animation Keyframes */}
          <style>{`
            @keyframes subPopIn {
              0% { transform: scale(0.85); opacity: 0.7; }
              100% { transform: scale(1.0); opacity: 1; }
            }
            @keyframes subFadeUp {
              0% { opacity: 0; transform: translateY(12px); }
              100% { opacity: 1; transform: translateY(0); }
            }
            @keyframes subZoomSoft {
              0% { transform: scale(1.08); }
              100% { transform: scale(1.0); }
            }
            @keyframes hookPopBounce {
              0% { transform: scale(0); opacity: 0; }
              60% { transform: scale(1.15); opacity: 1; }
              100% { transform: scale(1); opacity: 1; }
            }
            @keyframes hookZoomSlam {
              0% { transform: scale(1.65); opacity: 0; }
              100% { transform: scale(1); opacity: 1; }
            }
            @keyframes hookFadeSlideUp {
              0% { transform: translateY(45px); opacity: 0; }
              100% { transform: translateY(0); opacity: 1; }
            }
            @keyframes hookTypewriterFade {
              0% { opacity: 0; }
              100% { opacity: 1; }
            }
          `}</style>

          {/* Layer 2: Hook Banner Preview */}
          {showHook && (
            <div
              style={{
                position: 'absolute',
                top: edit.hook_y_margin,
                left: 60,
                right: 60,
                textAlign: 'center',
                zIndex: 15,
                pointerEvents: 'none',
              }}
            >
              <div
                key={`${edit.hook_animation}_${edit.hook_text}`}
                style={{
                  display: 'inline-block',
                  maxWidth: '92%',
                  padding: edit.hook_mode === 'box' ? '14px 28px' : '0',
                  background: edit.hook_mode === 'box' ? (edit.hook_box_color || '#121212') : 'transparent',
                  color: edit.hook_color || '#FFFFFF',
                  fontSize: `${edit.hook_font_size}px`,
                  fontFamily: edit.hook_font_family || edit.font_family || 'Arial',
                  fontWeight: 900,
                  borderRadius: edit.hook_mode === 'box' ? 12 : 0,
                  textShadow:
                    edit.hook_mode === 'box'
                      ? '0 4px 12px rgba(0,0,0,0.8)'
                      : edit.hook_mode === 'text'
                      ? '0 4px 16px rgba(0,0,0,0.9), 0 0 12px #000000'
                      : '0 2px 8px rgba(0,0,0,0.7)',
                  WebkitTextStroke: edit.hook_mode === 'text' ? '3px #000000' : 'none',
                  boxShadow: edit.hook_mode === 'box' ? '0 10px 30px rgba(0,0,0,0.6)' : 'none',
                  lineHeight: 1.2,
                  animation:
                    edit.hook_animation === 'pop_bounce'
                      ? 'hookPopBounce 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
                      : edit.hook_animation === 'zoom_slam'
                      ? 'hookZoomSlam 0.22s ease-out forwards'
                      : edit.hook_animation === 'fade_slide_up'
                      ? 'hookFadeSlideUp 0.28s ease-out forwards'
                      : edit.hook_animation === 'typewriter_fade'
                      ? 'hookTypewriterFade 0.3s ease-in-out forwards'
                      : 'none',
                }}
              >
                {applyHookLetterStyle(edit.hook_text)}
              </div>
            </div>
          )}

          {/* Layer 3: Overlay Webcam DST (Real-Time Canvas Crop Drag & Resize di atas 9:16 Canvas) */}
          {edit.webcam_enabled && (
            <div
              onMouseDown={(e) => handleDstMouseDown(e)}
              style={{
                position: 'absolute',
                left: currentDst.x,
                top: currentDst.y,
                width: currentDst.w,
                height: currentDst.h,
                border: `${edit.webcam_style?.border_px ?? 4}px solid ${edit.webcam_style?.border_color ?? '#FFFFFF'}`,
                borderRadius: `${edit.webcam_style?.radius_px ?? 16}px`,
                overflow: 'hidden',
                cursor: draggingDst ? 'grabbing' : 'grab',
                zIndex: 20,
                boxShadow: '0 8px 30px rgba(0,0,0,0.7), 0 0 0 2px rgba(198,255,61,0.5)',
              }}
            >
              {/* Real-Time Canvas Crop (Video lokal) ATAU Cropped Frame Preview (Mode YouTube) */}
              {isYoutubeMode ? (
                <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#12121A' }}>
                  <img
                    src={ytFrameUrl || `https://img.youtube.com/vi/${effectiveYoutubeId}/hqdefault.jpg`}
                    alt="Webcam Preview"
                    style={{
                      position: 'absolute',
                      width: `${(1 / Math.max(0.05, currentSrc.w)) * 100}%`,
                      height: `${(1 / Math.max(0.05, currentSrc.h)) * 100}%`,
                      left: `-${(currentSrc.x / Math.max(0.05, currentSrc.w)) * 100}%`,
                      top: `-${(currentSrc.y / Math.max(0.05, currentSrc.h)) * 100}%`,
                      objectFit: 'fill',
                      pointerEvents: 'none',
                    }}
                  />
                </div>
              ) : (
                <canvas
                  ref={webcamCanvasRef}
                  width={currentDst.w}
                  height={currentDst.h}
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'block',
                    background: '#17171F',
                  }}
                />
              )}

              {/* Badge Label */}
              <div
                style={{
                  position: 'absolute',
                  top: 6,
                  left: 6,
                  background: '#C6FF3D',
                  color: '#0B0B10',
                  fontSize: 10,
                  fontWeight: 800,
                  fontFamily: "'Montserrat', sans-serif",
                  padding: '2px 6px',
                  borderRadius: 4,
                  pointerEvents: 'none',
                }}
              >
                WEBCAM ({currentDst.w}x{currentDst.h})
              </div>

              {/* Resize Handle 4 Sudut */}
              {['nw', 'ne', 'se', 'sw'].map((h) => (
                <div
                  key={h}
                  onMouseDown={(e) => handleDstMouseDown(e, h)}
                  style={{
                    position: 'absolute',
                    width: 16,
                    height: 16,
                    background: '#C6FF3D',
                    border: '2px solid #0B0B10',
                    borderRadius: 3,
                    cursor: `${h}-resize`,
                    top: h.includes('n') ? 0 : 'auto',
                    bottom: h.includes('s') ? 0 : 'auto',
                    left: h.includes('w') ? 0 : 'auto',
                    right: h.includes('e') ? 0 : 'auto',
                    zIndex: 30,
                  }}
                />
              ))}
            </div>
          )}

          {/* Layer 4: Safe Margin Guides (TikTok / Reels / Shorts: 6% L / 12% R / 11% T / 22% B) */}
          {showSafeMargin && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 22 }}>
              {/* Box Margin Utama */}
              <div
                style={{
                  position: 'absolute',
                  top: '11%',
                  bottom: '22%',
                  left: '6%',
                  right: '12%',
                  border: '1.5px dashed rgba(251, 191, 36, 0.4)',
                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.03)',
                }}
              >
                {/* Badge Label SAFE MARGIN */}
                <div
                  style={{
                    position: 'absolute',
                    top: 8,
                    left: 8,
                    background: 'rgba(251, 191, 36, 0.18)',
                    border: '1px solid rgba(251, 191, 36, 0.45)',
                    color: '#FBBF24',
                    fontSize: 10,
                    fontWeight: 800,
                    fontFamily: "'Montserrat', sans-serif",
                    padding: '2px 7px',
                    borderRadius: 4,
                    letterSpacing: '0.5px',
                  }}
                >
                  SAFE MARGIN
                </div>
              </div>

              {/* Real-time Snapped Edge Highlight Lines */}
              {snapIndicators.marginL && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: '6%',
                    width: 0,
                    borderLeft: '2px solid #C6FF3D',
                    boxShadow: '0 0 12px rgba(198,255,61,0.95), 0 0 4px #C6FF3D',
                    zIndex: 25,
                  }}
                />
              )}
              {snapIndicators.marginR && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    right: '12%',
                    width: 0,
                    borderRight: '2px solid #C6FF3D',
                    boxShadow: '0 0 12px rgba(198,255,61,0.95), 0 0 4px #C6FF3D',
                    zIndex: 25,
                  }}
                />
              )}
              {snapIndicators.marginT && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: '11%',
                    height: 0,
                    borderTop: '2px solid #C6FF3D',
                    boxShadow: '0 0 12px rgba(198,255,61,0.95), 0 0 4px #C6FF3D',
                    zIndex: 25,
                  }}
                />
              )}
              {snapIndicators.marginB && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: '22%',
                    height: 0,
                    borderBottom: '2px solid #C6FF3D',
                    boxShadow: '0 0 12px rgba(198,255,61,0.95), 0 0 4px #C6FF3D',
                    zIndex: 25,
                  }}
                />
              )}
            </div>
          )}

          {/* Layer 5: Center Crosshair (+ Grid) Overlay */}
          {showGrid && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 23 }}>
              {/* Garis Vertikal Tengah (left: 50%) */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: '50%',
                  width: 0,
                  borderLeft: snapIndicators.centerX
                    ? '2px solid #C6FF3D'
                    : '1px dashed rgba(255,255,255,0.25)',
                  boxShadow: snapIndicators.centerX
                    ? '0 0 12px rgba(198,255,61,0.95), 0 0 4px #C6FF3D'
                    : 'none',
                  transition: 'border-color 0.1s, box-shadow 0.1s',
                }}
              />

              {/* Garis Horizontal Tengah (top: 50%) */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: '50%',
                  height: 0,
                  borderTop: snapIndicators.centerY
                    ? '2px solid #C6FF3D'
                    : '1px dashed rgba(255,255,255,0.25)',
                  boxShadow: snapIndicators.centerY
                    ? '0 0 12px rgba(198,255,61,0.95), 0 0 4px #C6FF3D'
                    : 'none',
                  transition: 'border-color 0.1s, box-shadow 0.1s',
                }}
              />

              {/* Titik Pusat Crosshair (+) */}
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 22,
                  height: 22,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: snapIndicators.centerX || snapIndicators.centerY ? '#C6FF3D' : 'rgba(255,255,255,0.35)',
                  fontSize: 20,
                  fontWeight: 400,
                  lineHeight: 1,
                  textShadow: snapIndicators.centerX || snapIndicators.centerY ? '0 0 10px rgba(198,255,61,0.95)' : 'none',
                  userSelect: 'none',
                }}
              >
                +
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Kontrol Player Bawah: Play/Pause, Scrubber Waktu Klip */}
      <div
        style={{
          background: '#F6F4F1',
          borderTop: '1px solid #D3D9D6',
          padding: '10px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <button
          onClick={togglePlay}
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: '#1D634E',
            color: '#F6F4F1',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(29, 99, 78, 0.3)',
          }}
        >
          <Icon icon={isPlaying ? 'solar:pause-bold-duotone' : 'solar:play-bold-duotone'} width={18} height={18} />
        </button>

        <button
          onClick={() => {
            setCurrentTime(edit.clip_start);
            ytTimeRef.current = edit.clip_start;
            if (isYoutubeMode) {
              ytSendCmd('seekTo', [edit.clip_start, true]);
            } else if (videoRef.current) {
              videoRef.current.currentTime = edit.clip_start;
            }
          }}
          title="Ulangi dari awal klip"
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            background: '#EFF2F0',
            color: '#111916',
            border: '1px solid #D3D9D6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <Icon icon="solar:restart-bold-duotone" width={14} height={14} />
        </button>

        {/* Scrubber Relatif Klip */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: '#5A635F', fontFamily: "'JetBrains Mono', monospace" }}>
            {Math.max(0, currentTime - edit.clip_start).toFixed(1)}s
          </span>
          <input
            type="range"
            min={edit.clip_start}
            max={edit.clip_end ?? videoMeta?.duration ?? 60}
            step={0.05}
            value={currentTime}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setCurrentTime(val);
              ytTimeRef.current = val;
              if (isYoutubeMode) {
                ytSendCmd('seekTo', [val, true]);
              } else if (videoRef.current) {
                videoRef.current.currentTime = val;
              }
            }}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 11, color: '#111916', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
            {((edit.clip_end ?? videoMeta?.duration ?? 60) - edit.clip_start).toFixed(1)}s
          </span>
        </div>
      </div>
    </div>
  );
}
