# uwum architecture

Rust owns the protocol; the WebView owns the pixels and the media.

```
src-tauri/src/
  lib.rs          tauri builder, command registry, uwum:// media protocol
  commands.rs     the whole IPC surface — thin wrappers, no logic
  dto.rs          the wire format (camelCase); mirrored by src/lib/types.ts
  error.rs        one error type, serialised as { kind, message }
  events.rs       events pushed to the frontend + the tasks producing them
  matrix/
    core.rs       MatrixCore: client, sync service, open timelines, room mirror
    session.rs    session persistence (OS keychain, file fallback)
    auth.rs       discovery, password/SSO login, restore, sync bootstrap
    rooms.rs      room summaries + the sliding-sync diff stream
    timeline.rs   open/close timelines, send, edit, react, redact, paginate
    media.rs      mxc:// fetching behind the uwum:// scheme
  verification.rs emoji SAS + key recovery
  rtc.rs          MatrixRTC membership + LiveKit token exchange

src/
  lib/ipc.ts      typed wrappers over every command and event
  lib/types.ts    mirror of dto.rs
  lib/diff.ts     applies VectorDiffs from the backend
  lib/richText.ts renders other people's HTML without trusting it
  lib/blobMedia.ts video/audio over IPC, because a custom scheme can't serve it
  lib/call.ts     LiveKit room, mic, participant state
  store/          zustand store: a projection of Rust's truth + UI state
  components/     the design, implemented
```

## Why the pieces sit where they do

**matrix-rust-sdk in the backend.** Keys and crypto never enter the WebView. The
SQLite store is encrypted with a passphrase held in the OS keychain.

**matrix-sdk-ui, not raw sync.** `SyncService` + `RoomListService` + `Timeline`
are the layer Element X is built on. They give us sliding sync, and timeline
aggregation — edits collapse into the original, reactions attach to their
target, replies resolve — which is most of "Discord parity" for free.

**Diffs, not snapshots.** The room list and each timeline stream `VectorDiff`s.
The frontend applies them in place, so a busy room doesn't re-render the world.

**Media over a custom scheme, not IPC.** `uwum://media/<encoded-mxc>?w=&h=` lets
the WebView cache and lazy-load avatars like any other image. Pushing base64
through IPC would cost megabytes per render. *Except* for video and audio — see
below.

**WebRTC in the WebView.** Rust does the Matrix half of a call (membership state
events, OpenID token → LiveKit JWT); `livekit-client` does the media. The
WebView already has echo cancellation and device handling we'd otherwise have to
rebuild.

## Traps

Every one of these cost real time to find. They are not obvious from the docs.

### The room list carries one event per room, not a timeline

`DEFAULT_LIST_TIMELINE_LIMIT` is 1 — that single event is the *sidebar preview*.
Opening a room must call `RoomListService::subscribe_to_rooms`, which raises the
limit and pulls the required state. Skip it and every room opens showing exactly
one message.

### Scroll-triggered pagination can't bootstrap itself

A room showing one message isn't scrollable, so the scroll handler never fires
and the user has no way to ask for history. `TimelineView` paginates until the
content overflows, then hands over to scrolling. It's gated on the timeline
actually being open — the room is selected before `open_timeline` resolves, and
paginating in that gap raises `NoTimeline`.

### Fresh allocations in zustand selectors loop forever

zustand compares snapshots by identity, so `s.timelines[key] ?? []` returns a new
array on every read and re-renders until React throws error #185. Derived arrays
are memoised in the component (`filterRooms`) and empties are module-level
constants (`NO_ITEMS`).

### Sync starts before the UI mounts

The session is restored — and syncing begins — before React subscribes, so the
backend's first room-list push has no listener. `MatrixCore.rooms` mirrors the
list and `get_rooms` serves a snapshot once the frontend is listening.

### `Device::is_verified()` is true for your own device before you verify it

It means "cross-signed **or** locally trusted", and the SDK locally trusts the
device it's running on. Use `is_verified_with_cross_signing()` for anything the
user reads as a security claim.

### Space membership is recorded twice and neither half is reliable

The space lists its children with `m.space.child`; a room *may* point back with
`m.space.parent`, but most never do. Filtering on `parentSpaces` alone shows an
empty space. `filterRooms` takes the union of both.

### WKWebView won't load `<video>`/`<audio>` from a custom URI scheme

Media elements are handed to AVFoundation, which never consults a
`WKURLSchemeHandler` — the request simply never arrives and the element reports
"format not supported" with nothing in the network log. Images are fine over
`uwum://`; media goes over IPC and gets wrapped in a `blob:` URL
(`src/lib/blobMedia.ts`). A blob typed `application/octet-stream` won't play
either, so the container is sniffed from the bytes.

### A thumbnail size is a cache key, and remote thumbnails fail slowly

`?w=&h=` goes into the URL, so every distinct pixel size is a separate entry in
the WebView cache, the SDK's media store *and* the homeserver's. Two components
drawing the same avatar at 34px and 66px fetch it twice. That's merely wasteful
for local media — but for *remote* media the server has to federate the original
before it can resize, and when that federation stalls the request sits for the
server's full timeout (ten seconds on Continuwuity) and comes back
`400 M_UNKNOWN` from the thumbnail endpoint, which reads like a client bug and
isn't one.

Four things keep it bearable. `Avatar` asks for one fixed size whatever it draws
at, so a person's picture is a single fetch app-wide and CSS does the scaling —
the profile card at 66px and the timeline at 38px share one cache entry.
`mediaUrl` snaps everything else up to one of a dozen standard buckets. A failed
thumbnail retries as the whole file, which often works because only the resize
needed the original. And a failed request is remembered for a minute so
re-renders fail instantly instead of queueing more ten-second waits — keyed by
URI *and size*, because "this size failed" is not "this media is unavailable",
and keying on the URI alone blanks avatars that were rendering fine.

### Encrypted attachments need the event's `MediaSource`, not just the URI

The keys live in the event; rebuilding a `MediaSource::Plain` from the `mxc://`
downloads ciphertext. Timeline conversion records the real source in
`media::remember_source` and the fetch path looks it up.

### The SDK's media cache is keyed by URI alone

A plain and an encrypted source for the same URI share one entry, so fetching
encrypted media as plain poisons the cache with ciphertext — and fixing the
fetch isn't enough on its own. `purge_poisoned_media_cache` drops the cache once,
behind a marker file.

### macOS needs `NSMicrophoneUsageDescription`

Without it in `Info.plist`, `enumerateDevices` returns nothing, no permission
prompt ever appears, and calls fail silently with no microphone.
`entitlements.plist` carries the matching
`com.apple.security.device.audio-input` for hardened-runtime builds.

## Rendering other people's HTML

Messages carry a `formatted_body`: an HTML subset written by whichever client
sent it, served by a homeserver we don't control. In a Tauri WebView, script
execution isn't a stolen cookie — it's the IPC bridge, and through it the session
and the message keys.

So `src/lib/richText.tsx` never touches `innerHTML`. It parses the markup inert
with `DOMParser`, walks it, and rebuilds it as React elements from an allowlist.
Unknown tags contribute their text and nothing else. Because we *construct*
elements rather than inject markup, an attribute we failed to anticipate has no
path to becoming executable. Links are restricted to http/https/mailto/matrix,
and images to `mxc:` — a remote `<img>` would leak the reader's IP to whoever
sent the message.

`src/lib/richText.test.tsx` is the guard on that, and reads as a list of the ways
it could go wrong.

## Calls

MatrixRTC as Element Call implements it, so calls interoperate with Element X:

1. Publish `org.matrix.msc3401.call.member` keyed `_@user:server_DEVICEID`,
   naming a preferred LiveKit focus.
2. Pick the focus from the oldest existing membership, so joiners land on the SFU
   already in use rather than starting a second one.
3. Trade a homeserver OpenID token at `<focus>/sfu/get` for a room-scoped JWT.
4. Connect `livekit-client` to the SFU with that JWT.

The SFU comes from `org.matrix.msc4143.rtc_foci` in the homeserver's
`.well-known`, or the override in settings.

Signalling reaches LiveKit over 443; **media does not**. If a call connects and
then immediately drops, the SFU's media ports (`rtc.udp_port` and
`rtc.tcp_port`) aren't reachable — and if you're testing from inside the same
LAN as the server, check NAT hairpinning before anything else.

## Where secrets live

`session.json` in the app data dir holds only non-secret pointers (which user,
which homeserver, which store directory). The access token and the SQLite
passphrase go to the OS keychain. If no keychain is available the app falls back
to a `0600` file **and says so in the UI** — the weaker storage is never silent.

## Tests

```bash
npm test                                              # frontend
cargo test --manifest-path src-tauri/Cargo.toml --lib # backend
```

The frontend suite is almost entirely the HTML sanitiser. The backend suite is
almost entirely media URL and byte-range parsing. Both are the places where
untrusted input meets code that has to be exactly right.
