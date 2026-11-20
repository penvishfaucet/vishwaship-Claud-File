"use client";
import { useEffect } from "react";

/** When the tracking page runs inside a client's website (track-embed.js iframe), tell the parent page its height. */
export function EmbedResize() {
  useEffect(() => {
    if (window.parent === window) return;
    const send = () => window.parent.postMessage({ type: "vishwaship-track-height", height: document.documentElement.scrollHeight }, "*");
    send();
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  return null;
}
