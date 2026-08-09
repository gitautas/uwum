# Planned features

Features researched but not built. Each section is meant to be enough to start
from cold: the spec, the exact event shapes, the APIs that already exist in the
version we pin, which files change, and the traps.

Two protocol features (custom emoji, room backgrounds), then interface work that
came out of using the thing, then the one piece of the client that is simply
absent: making and joining rooms. Extended profiles are built; what was learned
doing them is at the bottom.

Read [ARCHITECTURE.md](ARCHITECTURE.md) first — several traps there (the media
cache, the sanitiser, zustand selectors) are load-bearing for this work.

Verified against `matrix-sdk 0.18`, `ruma-events 0.34`, `livekit-client 2.x`.

---

## 1. Custom emoji and stickers

The largest thing in this file, and the most valuable. FluffyChat, Cinny and
Commet all implement it, so packs made elsewhere should just work.

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

## 3. Interface work

Four asks, all frontend except where noted. None of them need a spec — they're
ours to decide — so what's written down here is the shape and the traps.

### 3a. Zoom into a picture

Any image should open full-size: an attachment in the timeline, an avatar, a
profile card's cover. Right now a photo is only ever the 400×320 box the
timeline draws it in, and an avatar is 38px forever.

**Work** — a new `src/components/Lightbox.tsx`: a portal over everything, the
image centred at its natural size (capped to the window), click-away and Escape
out, arrow keys between the images in the room if that's cheap. Called from
`MessageRow`'s `ImageBody`, from `Avatar` (a click with no profile card
attached), and from the cover in `ProfileCard`.

**Traps**

- **Ask for the original, not a thumbnail.** `mediaUrl(mxc)` with no size gives
  the full file; passing a size here would both blur the image and add another
  entry to the cache-key mess described in ARCHITECTURE.md.
- Encrypted attachments already work through `uwum://` because the timeline
  registered their `MediaSource` — but only for URIs the timeline has seen.
  Don't build the lightbox to take a bare mxc from somewhere else.
- An animated GIF at full size decodes at full size. Fine for one, so keep the
  lightbox to one image at a time.
- "Save" belongs here too: `save_media` already exists and takes a destination.

### 3b. Stage attachments in the composer

Paste and drop currently send immediately, one event per file. They should land
in the composer as pending attachments instead — thumbnails in a tray above the
text box, removable, sent with the message when you hit send. This is what makes
"three screenshots and a sentence" one message instead of four.

**Work**

- `Draft` in `src/store/index.ts` grows `attachments: PendingAttachment[]` —
  `{ id, name, mime, size, previewUrl, bytes | path }`. Files pasted arrive as
  bytes, dropped ones as paths; keep both shapes rather than reading every
  dropped file into memory.
- `Composer.tsx`: the tray, a remove button per item, and `submit()` sending the
  attachments before the text.
- `lib/upload.ts` becomes staging rather than sending; `DropZone` and the paste
  handler call into it unchanged.

**Traps**

- **Matrix has no multi-file message** in the stable spec — each attachment is
  its own event. MSC4274 galleries do exist and `Timeline::send_gallery` is
  right there in matrix-sdk-ui 0.18, but behind the `unstable-msc4274` feature
  flag, and other clients will show a gallery as separate files at best. Send N
  events unless we decide to turn the flag on.
- A caption attaches to *one* event. Decide where the composer text goes: on the
  first attachment (Element's behaviour) or as its own message after.
- Pasted bytes sit in memory until send. The 100mb cap in `upload.ts` is now a
  cap on the whole tray, not on one file.
- Preview URLs from `URL.createObjectURL` need revoking when an item is removed
  or the draft is cleared, or the WebView holds every screenshot you pasted all
  session.

### 3c. The DM sidebar should show the person, not the room

In a DM, `RoomInfo`'s header draws a room avatar and a room ID. There's a person
on the other side with a cover photo and a bio that we already fetch elsewhere —
that header should look like the top of their profile card.

**Work** — in `RoomInfo.tsx`, when `room.isDirect`, find the other member
(the member list is already loaded) and use `get_profile` for their cover, then
draw cover + avatar + name + status the way `ProfileCard` does. The two should
share a component rather than growing a second copy of the layout.

**Traps**

- A DM is not guaranteed to have exactly two members, and you might be alone in
  one. Fall back to the room header.
- The cover is a *profile* field, not a room field: it changes under you when
  they change it, and it's the same picture in every DM with them.
- This is the third caller of `get_profile` — the cache mentioned at the bottom
  of this file stops being optional here.

### 3d. Room toggles as icons

The three switches at the bottom of `RoomInfo` — mute, favourite, low priority —
take a third of the panel to say three booleans. They should be a row of icon
buttons: filled and accent-coloured when on, hairline outline when off, with the
label as a tooltip.

`ToggleRow` in `RoomInfo.tsx` is the only user of that pattern, so it can be
replaced outright. Note that `SettingsView.tsx` has its own private `Toggle` —
a second, differently-drawn switch. Two hand-rolled switches is already one too
many: whatever replaces `ToggleRow` belongs in `ui.tsx`, and `Toggle` should
move there with it rather than a third one appearing later.

---

## 4. Creating and joining rooms

The app cannot make a room, and the only way into one is to be invited. This is
the largest hole in the client, and it is *missing*, not broken: `git grep` and
`git log --all -S` over every ref find no create-room code that was ever written
and later removed. `joinRoom` in `src/lib/ipc.ts` has existed since the IPC
bridge landed and has never had a caller.

**Where the memory of a button comes from.** `RoomList.tsx` renders "no rooms
yet — join one to get started" whenever the filtered list is empty — which
includes selecting a space whose rooms you haven't joined, since `filterRooms`
returns nothing for it. So picking a space can replace the room list with an
instruction to do something the UI offers no way of doing. Fix the empty state
in the same change; it should offer the action it's naming.

### Work

**Rust** (`matrix/rooms.rs`) — `create_room(request) -> room_id` over
`client.create_room(...)`. The parameters worth exposing: name, topic, whether
it's public or invite-only (`RoomPreset`), whether to encrypt it, and an
optional list of people to invite. Encryption is an `m.room.encryption` initial
state event; `Client::create_dm` in the SDK is the worked example of setting it,
and it's the reason DMs made here are encrypted.

`join_room` already exists and takes an alias or ID.

**Frontend** — a `+` in the room list header opening a small dialog with two
modes, create and join. Reuse the settings modal's shape rather than inventing a
third kind of overlay.

### Traps

- **A room created while a space is selected should land in that space**, or it
  vanishes from the list the moment it's made — the user is looking at a
  filtered view. That means sending `m.space.child` into the space, which needs
  power there; when the user hasn't got it, say so rather than silently making
  an orphan room. Setting `m.space.parent` on the child too is polite but not
  sufficient on its own — see the space-membership trap in ARCHITECTURE.md.
- Encryption cannot be turned on later in any meaningful sense, and cannot be
  turned off at all. The checkbox at creation is the only moment it's a choice,
  so word it accordingly.
- A public room wants an alias; alias collisions are a normal, expected error
  and need to read as one.
- After `create_room` the room arrives through the sliding-sync stream like any
  other, so don't insert it into the store by hand — select it by ID and let the
  diff fill it in.

---

## 5. Profile cover photo and bio — built

Kept as a record of what the code does and why, not as work to do.

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

1. Creating and joining rooms. Small, and the app is hard to defend without it —
   it currently tells you to join a room and then offers no way to.
2. The interface work, cheapest first: room toggles (3d), then the lightbox
   (3a), then the DM sidebar header (3c) — which is where the profile cache
   stops being optional — then staging attachments in the composer (3b), the
   only one of the four with a real design decision in it.
3. Room backgrounds — self-contained, finishable in one sitting. The upload it
   needs already exists as `upload_media`, built for cover photos.
4. Custom emoji and stickers — the big one, in this order: pack storage →
   picker → sending → reactions → import → autocomplete.
