"use client";
import { useEffect, useRef, useState } from "react";

/** Square crop for team photos: zoom + drag, live preview, exports a 512×512 JPEG blob. */
export function PhotoCropper({ file, onCancel, onDone }: { file: File; onCancel: () => void; onDone: (blob: Blob) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const SIZE = 320;

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function draw(ctx: CanvasRenderingContext2D, size: number) {
    if (!img) return;
    const base = Math.max(size / img.width, size / img.height) * zoom;
    const w = img.width * base, h = img.height * base;
    const k = size / SIZE;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, (size - w) / 2 + off.x * k, (size - h) / 2 + off.y * k, w, h);
  }
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (ctx) draw(ctx, SIZE);
  });

  function exportBlob() {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const ctx = c.getContext("2d")!;
    draw(ctx, 512);
    c.toBlob((b) => b && onDone(b), "image/jpeg", 0.88);
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Crop photo" style={{ position: "fixed", inset: 0, background: "rgba(11,31,58,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
      <div className="card" style={{ padding: 18, maxWidth: 380, width: "100%" }}>
        <b>Crop photo</b>
        <p className="tiny muted" style={{ margin: "4px 0 10px" }}>Drag to position, use the slider to zoom. Shown as a circle on the website.</p>
        <canvas
          ref={canvas} width={SIZE} height={SIZE}
          style={{ width: "100%", aspectRatio: "1", borderRadius: "50%", cursor: "grab", touchAction: "none", background: "#eee" }}
          onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { const d = drag.current; if (d) setOff({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }); }}
          onPointerUp={() => { drag.current = null; }}
        />
        <label className="small" style={{ display: "block", marginTop: 10 }}>Zoom
          <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ width: "100%" }} />
        </label>
        <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-orange btn-sm" onClick={exportBlob} disabled={!img}>Use photo</button>
        </div>
      </div>
    </div>
  );
}
