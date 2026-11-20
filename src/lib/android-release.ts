/**
 * The Android APK offered for direct download on /download-app/. The file itself lives in /public/downloads/.
 * Update these values whenever a new signed APK is published (versionCode must always go up).
 */
export const ANDROID_RELEASE = {
  versionName: "1.0.0",
  versionCode: 1,
  file: "/downloads/vishwaship-1.0.0.apk",
  sizeMb: 2.8,
  sha256: "8ed4ed78573edbafc7af2545a4d44a3b4f65269570ebcace2e65e70f0d3cc864",
  releasedOn: "2026-11-20",
  minAndroid: "Android 8.0",
} as const;
