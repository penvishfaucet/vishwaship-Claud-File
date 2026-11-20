/**
 * The Android APK offered for direct download on /download-app/. The file itself lives in /public/downloads/.
 * Update these values whenever a new signed APK is published (versionCode must always go up).
 */
export const ANDROID_RELEASE = {
  versionName: "1.1.0",
  versionCode: 2,
  file: "/downloads/vishwaship-1.1.0.apk",
  sizeMb: 1.2,
  sha256: "10a265299817ec2df441ca42db564173c83db5326f99f0ef766e508d98ad69a6",
  releasedOn: "2026-11-20",
  minAndroid: "Android 8.0",
} as const;
