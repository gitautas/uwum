# uwum

A Matrix client with end-to-end encryption and LiveKit voice, in the UwU design
system. Tauri 2 + Rust backend, React + TypeScript frontend.

```bash
npm install
npm run app          # dev, with hot reload
npm run app:build    # release .app / .dmg

npm run android         # dev build on a connected device
npm run android:build -- --apk   # release .apk (--aab for Play)

npm run ios             # dev build on a connected device or simulator
npm run ios:build       # release .ipa
```

macOS and iOS build today, and Android runs on a device. Linux and Windows are
kept viable — no macOS-only crates, and both custom-protocol URL forms are
handled — but neither is tested yet.

Android needs an SDK, an NDK and a JDK. `npm run android` finds all three
itself if they are installed; from nothing, that is:

```bash
brew install --cask android-commandlinetools temurin
sdkmanager --licenses
sdkmanager platform-tools "platforms;android-36" "build-tools;36.0.0" "ndk;27.3.13750724"
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

## Mobile releases

The release workflow builds a signed `.apk` and `.ipa` on every `v*` tag, and on
demand via *Run workflow* (which attaches them as run artifacts instead of
touching a release). Both jobs **fail without their signing secrets** rather
than attaching something nobody can install, so a tag will not publish until
these exist in the repository's Actions secrets:

| Secret | What it is |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 release.jks` — the keystore itself |
| `ANDROID_KEYSTORE_PASSWORD` | its store password |
| `ANDROID_KEY_ALIAS` | the alias inside it |
| `ANDROID_KEY_PASSWORD` | that key's password |
| `IOS_CERTIFICATE_BASE64` | `base64 -w0 cert.p12` — an Apple distribution certificate |
| `IOS_CERTIFICATE_PASSWORD` | the password set when exporting the `.p12` |
| `IOS_PROVISIONING_PROFILE_BASE64` | `base64 -w0 profile.mobileprovision` |

A keystore, once made, cannot be replaced: Android identifies an app by its
signing key, so a new one is a new app that cannot update the old.

```bash
keytool -genkeypair -v -keystore release.jks -alias uwum \
  -keyalg RSA -keysize 4096 -validity 10000
```

The iOS profile is an **ad-hoc** one, matching the workflow's
`--export-method release-testing`: it installs only on the devices listed in
the profile, so a new phone means a new profile. For TestFlight instead, swap
that for `app-store-connect` and use a distribution profile.

Locally, neither is needed — a debug build signs itself, and
`src-tauri/gen/android/keystore.properties` (gitignored) is read if you want to
sign a local release build.

## What works

Login (password and SSO), session persistence in the OS keychain, sliding sync,
room list with spaces and favourites, timeline with replies, reactions, threads,
edits, redactions, typing, read receipts and file upload, device verification,
voice calls over MatrixRTC, and profiles — bio, status and cover photo, with a
card behind every avatar.

## Where to look next

- [ARCHITECTURE.md](ARCHITECTURE.md) — how it's put together, and the traps that
  cost hours to find. Read the traps before changing anything in the timeline or
  media paths.
- [DESIGN.md](DESIGN.md) — the visual spec: tokens, voice, motion, and the rules
  the UI is meant to hold to.
- [PLAN.md](PLAN.md) — features researched but not built: custom emoji and
  stickers, room backgrounds. Event shapes and traps included.

---

*This file is a placeholder — the two documents above carry the real content.*
