# uwum

A Matrix client with end-to-end encryption and LiveKit voice, in the UwU design
system. Tauri 2 + Rust backend, React + TypeScript frontend.

```bash
npm install
npm run app          # dev, with hot reload
npm run app:build    # release .app / .dmg

npm run android         # dev build on a connected device
npm run android:build   # release .apk / .aab
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
