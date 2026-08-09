# Planned features

Two features, researched but not built. Each section is meant to be enough to
start from cold: the spec, the exact event shapes, the APIs that already exist
in the version we pin, which files change, and the traps.

The third — extended profiles — is built; what was learned doing it is at the
bottom.

Read [ARCHITECTURE.md](ARCHITECTURE.md) first — several traps there (the media
cache, the sanitiser, zustand selectors) are load-bearing for this work.

Verified against `matrix-sdk 0.18`, `ruma-events 0.34`, `livekit-client 2.x`.

---

## 1. Custom emoji and stickers

The most valuable of the three, and the largest. FluffyChat, Cinny and Commet
all implement it, so packs made elsewhere should just work.

### Spec: MSC2545 image packs

Packs live in two places, both plain JSON:

**Room pack** — state event `im.ponies.room_emotes`, state key is the pack id
(`""` for the room's default pack). Anyone with permission can add packs to a
room.

**Personal pack** — account data `im.ponies.user_emotes`. Yours everywhere.

**Which room packs are globally enabled** — account data
`im.ponies.emote_rooms`:

```json
{ "rooms": { "!room:server": { "pack-id": {} } } }
```

Pack content, identical in both cases:

```json
{
  "pack": {
    "display_name": "my pack",
    "avatar_url": "mxc://…",
    "usage": ["emoticon", "sticker"],
    "attribution": "optional"
  },
  "images": {
    "shortcode": {
      "url": "mxc://…",
      "body": "optional description",
      "usage": ["emoticon"],
      "info": { "w": 128, "h": 128, "mimetype": "image/png", "size": 4096 }
    }
  }
}
```

`usage` on an image overrides the pack's. Absent usage means both. `emoticon`
means it can be sent inline and used as a reaction; `sticker` means it can be
sent as a standalone `m.sticker`.

### Sending

**Inline emoji** — a normal `m.room.message` whose `formatted_body` contains:

```html
<img data-mx-emoticon src="mxc://…" alt=":shortcode:" title=":shortcode:" height="32" />
```

The plain `body` should carry `:shortcode:` so clients without support see
something readable.

**Sticker** — `AnyMessageLikeEventContent::Sticker(StickerEventContent)` through
the existing `Timeline::send`. The variant exists in ruma 0.34.

**Reaction** — MSC4027: the reaction key is the `mxc://` URI itself rather than
a unicode grapheme. Support is patchy; send it, and render unknown keys
gracefully.

### What already works

Worth knowing before estimating — the receive path is most of the way there.

- **Stickers already render.** `dto.rs` maps `MsgLikeKind::Sticker` to
  `ContentDto::Sticker` and `MessageRow` draws it.
- **Inline custom emoji already render.** `richText.tsx` allows `<img>` with an
  `mxc:` source, so an emoji sent from FluffyChat shows up today — but at the
  240×180 block size the renderer uses for inline images. It needs to detect
  `data-mx-emoticon` and render at roughly `1.4em`, `vertical-align: middle`,
  inline.
- **Custom-emoji reactions are broken-looking.** `MessageRow` renders
  `reaction.key` as text, so an mxc key shows as a raw URI. Needs an
  `key.startsWith("mxc://")` branch drawing an `<img>`.

### Work

**Rust** — new `src-tauri/src/matrix/packs.rs`:

- `get_image_packs()` — read `im.ponies.user_emotes` via
  `client.account().account_data_raw("im.ponies.user_emotes")`, plus each room's
  `im.ponies.room_emotes` via `room.get_state_event(...)`, filtered by
  `im.ponies.emote_rooms`. Return a flat `Vec<ImagePackDto>`.
- `save_user_pack(pack)` — `account().set_account_data_raw(...)`.
- `save_room_pack(room_id, pack_id, pack)` — `room.send_state_event_raw(...)`.
- `upload_image(path) -> mxc` — `client.media().upload(&mime, bytes, None)`.
  Signature confirmed: `upload(&Mime, Vec<u8>, Option<RequestConfig>)`.
- `send_sticker(room_id, mxc, body, info)`.

**Importing packs.** Two sources, both ours to define:

- *Loose files* — a multi-file picker; shortcode defaults to the filename stem.
- *Discord/Slack export* — these are lists of `{name, url}` (Discord emoji are
  `https://cdn.discordapp.com/emojis/<id>.png`). Fetch each in Rust with
  `reqwest`, upload to our media repo, build a pack. **Do the fetching in Rust,
  not the WebView** — the CSP forbids remote origins, and it keeps a remote URL
  from ever being handed to an `<img>`.

Cap the number and size of images per import; a malicious "pack" is otherwise an
easy way to fill someone's media repo.

**Frontend**

- `src/lib/packs.ts` — types and IPC wrappers.
- `src/components/EmojiPicker.tsx` — tabbed by pack, one grid, a search box.
  Opens from the composer's smiley and from the message hover toolbar (for
  reactions). Reuse `QUICK_REACTIONS` as the "frequently used" row.
- Composer: `:shortcode:` autocomplete. A popup over the composer filtering as
  you type, Tab/Enter to accept. **This is the fiddliest part** — leave it last,
  the picker is usable without it.
- `richText.tsx`: inline sizing for `data-mx-emoticon`.
- `MessageRow`: image reactions, and a sticker-sized branch.
- Settings: a "emoji & stickers" section for managing and importing packs.

### Traps

- Shortcodes collide across packs. Resolution order should be personal pack,
  then this room's, then other enabled rooms — and the picker should show which
  pack an emoji came from when ambiguous.
- Sending an emoji means sending Markdown *and* HTML. The composer currently
  always sends `markdown: true`; injecting `<img>` into a Markdown body needs
  care, or build the `formatted_body` directly and bypass the Markdown path.
- Animated GIF emoji at 32px still decode at full size. Fine for a few, a
  problem for a wall of them.

---

## 2. Room backgrounds

Small, self-contained, and entirely ours.

### There is no MSC for this

Nothing standard exists. Element, FluffyChat and Cinny don't have it; SchildiChat
does wallpapers but locally, not shared. So "set it for everyone" means a
namespaced state event that only uwum reads:

```
type:      gg.uwu.room_background
state_key: ""
content:   { "url": "mxc://…", "blur": 0.0–1.0, "dim": 0.0–1.0 }
```

Being namespaced is the point — if an MSC ever lands, we read both and write the
standard one. Don't squat on an `m.*` name.

A local-only background (just for you) belongs in account data or
`localStorage`, keyed by room ID. Offer both: "just for me" and "for everyone in
this room".

### Work

**Rust** (`matrix/rooms.rs`):
- `get_room_background(room_id)` — `room.get_state_event("gg.uwu.room_background", "")`,
  deserialise leniently, return `None` on anything unexpected.
- `set_room_background(room_id, url, blur, dim)` — `send_state_event_raw`.
  Requires power to send state; surface a clear error when the user can't.
- Reuse the `upload_image` command from feature 1 — worth building that first
  either way.

**Frontend**
- `RoomInfo.tsx`: a "background" section — a preview, an upload button
  (`@tauri-apps/plugin-dialog`), a blur slider, a dim slider, a "for everyone"
  toggle, and remove.
- `ChatPane.tsx`: render the image behind the timeline —
  `position: absolute; inset: 0; background-image: url(uwum://media/…);
  background-size: cover; filter: blur(Npx); z-index: 0`, with the timeline and
  composer above it. The existing `.uwu-pattern` is the precedent.
- Add `background` to `RoomSummary` so the room list doesn't need a second
  round trip.

### Traps

- **Legibility is the whole problem.** Message text sits directly on this. The
  dim layer isn't optional garnish — without it a light photo makes the room
  unreadable. Consider forcing a minimum dim, and check the timeline against a
  white image before calling it done.
- Blur on a large image is expensive to repaint. Blur once into a scaled-down
  copy rather than applying a large CSS blur radius to a full-size background on
  every scroll.
- The `uwum://` media protocol serves this fine — but a background is a *large*
  image, so request a thumbnail rather than the original.

---

## 3. Profile cover photo and bio — built

Kept as a record; the spec above it is what the code implements.

Bio and status use Commet's keys (`chat.commet.profile_bio`, an object with a
`body`; `chat.commet.profile_status`, a bare string) so a bio written in either
client shows in the other. Cover photos are `gg.uwu.cover_url` — nothing else
writes one, so only uwum reads it. Continuwuity implements MSC4133 without
advertising `uk.tcpip.msc4133`, which is why an earlier capability check
concluded wrongly: test the endpoint, not the advertisement.

Editing is in settings → account. Reading is the profile card, which hangs off
any avatar in the app (`src/components/ProfileCard.tsx`) and also shows shared
rooms and a way into a DM.

**Shared rooms are two sources unioned**, because neither is complete: MSC2666
(`/_matrix/client/unstable/uk.half-shot.msc2666/user/mutual_rooms`), which not
every server implements, plus a local scan with `get_member_no_sync`, which only
sees rooms whose member list has been loaded. Neither is worth a network round
trip per room, so an incomplete list is the accepted trade.

Remaining: profile fields are refetched each time a card opens. Fine at this
size, worth a cache if cards get opened in bulk.

## Suggested order

1. Room backgrounds — self-contained, finishable in one sitting. The upload it
   needs already exists as `upload_media`, built for cover photos.
2. Custom emoji and stickers — the big one, in this order: pack storage →
   picker → sending → reactions → import → autocomplete.
