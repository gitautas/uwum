import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";

// `tauri android` needs three environment variables that nothing else on a
// developer machine sets: where the SDK is, which NDK inside it to build
// against, and which JDK Gradle should run on. Rather than ask everyone to
// paste exports into their shell profile — and get a different NDK than CI —
// this works them out from whatever is actually installed and hands them to
// the Tauri CLI.
//
//   npm run android          # dev build on the connected device
//   npm run android:build    # release APK/AAB

// Homebrew's `android-commandlinetools` cask and Android Studio put the SDK in
// different places, and Linux differs again. First one that exists wins.
const SDK_CANDIDATES = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  "/opt/homebrew/share/android-commandlinetools",
  "/usr/local/share/android-commandlinetools",
  path.join(os.homedir(), "Library/Android/sdk"),
  path.join(os.homedir(), "Android/Sdk"),
];

function fail(message) {
  console.error(`\nAborting: ${message}`);
  process.exit(1);
}

const sdk = SDK_CANDIDATES.find((dir) => dir && fs.existsSync(path.join(dir, "platform-tools")));
if (!sdk) {
  fail(
    "no Android SDK found. Install one with `brew install --cask android-commandlinetools`,\n" +
      "then `sdkmanager --licenses` and `sdkmanager platform-tools 'platforms;android-36' 'build-tools;36.0.0' 'ndk;27.3.13750724'`.",
  );
}

// Side-by-side NDKs sort as version strings; take the newest rather than
// pinning a build number that only exists on one machine.
const ndkRoot = path.join(sdk, "ndk");
const ndks = fs.existsSync(ndkRoot)
  ? fs.readdirSync(ndkRoot).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    )
  : [];
if (ndks.length === 0) {
  fail(`no NDK under ${ndkRoot}. Install one with \`sdkmanager 'ndk;27.3.13750724'\`.`);
}

// Gradle picks up a stray JDK 8 or 17 from the PATH otherwise, and the Android
// Gradle Plugin the template pins wants 17+.
let javaHome = process.env.JAVA_HOME;
if (!javaHome && process.platform === "darwin") {
  try {
    javaHome = execFileSync("/usr/libexec/java_home", ["-v", "21"], { encoding: "utf8" }).trim();
  } catch {
    fail("no JDK 21. Install one with `brew install --cask temurin`.");
  }
}

const env = {
  ...process.env,
  ANDROID_HOME: sdk,
  NDK_HOME: path.join(ndkRoot, ndks[ndks.length - 1]),
  ...(javaHome ? { JAVA_HOME: javaHome } : {}),
};

console.log(`ANDROID_HOME=${env.ANDROID_HOME}`);
console.log(`NDK_HOME=${env.NDK_HOME}`);

const result = spawnSync("npx", ["tauri", "android", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});
process.exit(result.status ?? 1);
