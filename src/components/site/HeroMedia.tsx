"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Hero background: muted inline looping video with a Pause/Play control, or the poster image when there is no
 * video, the visitor prefers reduced motion, or saves data. The poster is always the first paint.
 */
export function HeroMedia({ video, poster }: { video: string; poster: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [useVideo, setUseVideo] = useState(false);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!video) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    setUseVideo(!reduce && !saveData);
  }, [video]);
  function toggle() {
    const v = ref.current;
    if (!v) return;
    if (v.paused) { void v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  }
  return (
    <>
      <div className="w-hero-media" aria-hidden="true">
        {useVideo
          ? <video ref={ref} src={video} poster={poster || undefined} autoPlay muted loop playsInline preload="metadata" onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
          : poster ? <img src={poster} alt="" fetchPriority="high" decoding="async" /> : null}
      </div>
      {useVideo && (
        <button type="button" className="w-vidctl" onClick={toggle} aria-pressed={!playing}>
          {playing
            ? <><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>Pause video</>
            : <><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z" /></svg>Play video</>}
        </button>
      )}
    </>
  );
}
