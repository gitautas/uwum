## What's new

### uwum updates itself

The desktop builds now check for a new version on launch and offer to install
it. Accept, and it downloads, verifies the signature and restarts into the new
version — no visit to this page required, ever again. There is also a
**check now** button under *settings → about* if you would rather ask than be
told.

Every update is cryptographically signed, and the app installs nothing that
does not carry that signature.

### Runs on Android

uwum now builds and runs on Android, microphone permission included, so voice
calls work on a phone.

### Calls ring

An incoming call in a DM now rings, instead of appearing silently and hoping
you were looking.

### Fixes

- Device verification could get stuck when the state did not match the flow it
  belonged to.
- Two stream tasks could end up watching the same timeline, doubling events.
- The window can be dragged by its title bar again.

<!-- Prepend the changelog for this release above this line before publishing. -->

## Updating

The macOS, Windows and AppImage builds update themselves: they check on launch
and offer the new version in-app. A `.deb` is owned by your package manager
rather than by uwum, so those builds tell you a release is out and send you back
here instead.

This release is **desktop only** — the Android and iOS builds are not signed
yet, so no `.apk` or `.ipa` is attached.

## Installing

These builds are **not code-signed** yet, so each OS warns on first launch. This is
expected; here is how to get past it.

### macOS — `.dmg` (Apple Silicon: `aarch64`, Intel: `x64`)

The app is ad-hoc signed but not notarized. On first launch macOS will refuse to
open it ("Apple could not verify…"). Either:

1. Open **System Settings → Privacy & Security**, scroll down, and click
   **Open Anyway** (macOS 15+ removed the old right-click → Open shortcut), or
2. clear the quarantine flag in a terminal: `xattr -cr /Applications/uwum.app`

### Windows — `.msi` / `-setup.exe` (x64)

SmartScreen will show "Windows protected your PC". Click **More info → Run anyway**.
The `-setup.exe` (NSIS) installer installs per-user and needs no admin rights; the
`.msi` installs per-machine. On Windows-on-ARM devices, use the x64 build — it runs
under emulation.

### Linux — `.deb` / `.AppImage` (x86_64 `amd64` and arm64 `aarch64`)

- **AppImage:** `chmod +x uwum_*.AppImage`, then run it. No installation needed.
- **deb:** requires Ubuntu 22.04+ / Debian 12+ (WebKitGTK 4.1):
  `sudo apt install ./uwum_*.deb`
- Known gap: **voice calls do not work on Linux yet** (WebKitGTK's WebRTC support
  is not enabled by the app). Everything else, including E2EE messaging, works.
