import type { MetadataRoute } from "next";

/** Web app manifest: name, colours and icons when the site is added to a phone's home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vishwaship — Courier & Cargo Across India",
    short_name: "Vishwaship",
    description: "Compare courier rates, book parcels and cargo, schedule pickups and track shipments across India.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#13214a",
    icons: [
      { src: "/favicon.ico", sizes: "16x16 32x32 48x48", type: "image/x-icon" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    ],
  };
}
