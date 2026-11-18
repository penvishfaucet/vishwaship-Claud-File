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
    return [{ source: "/:path*", headers: securityHeaders }];
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
