import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  // Production build type-checks only app code; tests/tool configs need devDependencies, which hosts skip.
  typescript: { tsconfigPath: "tsconfig.build.json" },
  // local only: lets a second dev server run side by side (e.g. NEXT_DIST_DIR=.data/next-alt)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  trailingSlash: true, // keeps existing public paths (/book/, /login/, /track/ …)
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Admin uploads the UPI QR through a server action (QR images are capped at 2 MB in code)
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  async headers() {
    return [
      { source: "/:path((?!s/).*)", headers: securityHeaders },
      // storefronts: the portal theme editor previews them in a same-origin iframe
      { source: "/s/:path*", headers: securityHeaders.map((h) => (h.key === "X-Frame-Options" ? { key: h.key, value: "SAMEORIGIN" } : h)) },
    ];
  },
  /**
   * Merchant custom domains (off unless STORE_CUSTOM_DOMAINS=on at build time — switch it on only after the edge proxy
   * that issues SSL for merchant domains is connected). Any request whose Host is not one of the platform's own hosts
   * is served by the storefront, which finds the store from the Host header (verified domains only).
   */
  async rewrites() {
    if (process.env.STORE_CUSTOM_DOMAINS !== "on") return [];
    const own = ["localhost", "127\\.0\\.0\\.1", "(?:www\\.)?vishwaship\\.in", "(?:www\\.)?vishwaship\\.com",
      ...(process.env.PLATFORM_HOSTS ?? "").split(",").map((h) => h.trim().replace(/\./g, "\\.")).filter(Boolean)];
    const merchantHost = [{ type: "host" as const, value: `^(?!(?:${own.join("|")})$).+$` }];
    return {
      beforeFiles: [
        { source: "/", has: merchantHost, destination: "/s/~d/" },
        { source: "/:path((?!_next/|api/store-media/|store-demo/|favicon\\.png).*)", has: merchantHost, destination: "/s/~d/:path" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async redirects() {
    return [
      { source: "/franchise-login/", destination: "/admin/login/", permanent: false },
      { source: "/portal/shipments/", destination: "/portal/orders/", permanent: true },
      { source: "/admin/portal/", destination: "/admin/", permanent: true },
    ];
  },
};

export default config;
