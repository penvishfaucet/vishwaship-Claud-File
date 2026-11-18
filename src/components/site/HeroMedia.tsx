"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Hero background. Image first (responsive <picture>: portrait crop on phones, wide crop elsewhere) so the
 * hero paints immediately; an uploaded video replaces it only when the visitor allows motion and is not
 * saving data. Pause/Play control for the video.
 */
export function HeroMedia({ video, poster, mobile }: { video: string; poster: string; mobile?: string }) {
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
          : poster ? (
            <picture>
              {mobile && <source media="(max-width: 719px)" srcSet={mobile} />}
              <img src={poster} alt="" fetchPriority="high" decoding="async" />
            </picture>
          ) : null}
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
