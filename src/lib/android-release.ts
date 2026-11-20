/**
 * The Android APK offered for direct download on /download-app/. The file itself lives in /public/downloads/.
 * Update these values whenever a new signed APK is published (versionCode must always go up).
 */
export const ANDROID_RELEASE = {
  versionName: "1.2.0",
  versionCode: 3,
  file: "/downloads/vishwaship-1.2.0.apk",
  sizeMb: 1.7,
  sha256: "d8b042dccb80f02d4e1d1c48762a0e63a92a6bff2d5bf279a8b5c219bb38978e",
  releasedOn: "2026-11-20",
  minAndroid: "Android 8.0",
} as const;
