//! Custom emotes and stickers — MSC2545 image packs.
//!
//! An image pack is a set of named images. The name is a shortcode (`blobcat`),
//! written `:blobcat:` where a person types it, and each image says whether it's
//! usable as an inline emote, as a sticker, or both.
//!
//! Packs live in two places, and the difference is who they belong to:
//!
//! * `im.ponies.user_emotes` in account data — yours, on every device you sign
//!   in from, visible to nobody else.
//! * `im.ponies.room_emotes` as room state — the room's, shared with everyone
//!   in it. A room can hold several, one per state key.
//!
//! A third event, `im.ponies.emote_rooms` in account data, is the list of room
//! packs you've chosen to carry with you everywhere rather than only using in
//! the room they came from.
//!
//! Everything is parsed leniently. These events are written by other clients
//! and edited by hand, so a pack with one malformed image should lose that
//! image, not the pack — and a malformed pack should lose the pack, not the
//! user's whole emote set.

use std::collections::BTreeMap;

use matrix_sdk::{
    deserialized_responses::RawAnySyncOrStrippedState,
    ruma::{RoomId, events::StateEventType},
};
use serde::{Deserialize, Serialize};

use crate::{
    error::{Error, Result},
    matrix::MatrixCore,
};

pub const USER_EMOTES: &str = "im.ponies.user_emotes";
pub const ROOM_EMOTES: &str = "im.ponies.room_emotes";
pub const EMOTE_ROOMS: &str = "im.ponies.emote_rooms";

// ---------------------------------------------------------------------------
// the wire format
// ---------------------------------------------------------------------------

/// An `im.ponies.*` pack event, as it appears on the wire.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct ImagePackContent {
    #[serde(default)]
    pub images: BTreeMap<String, PackImage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pack: Option<PackInfo>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct PackInfo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct PackImage {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub info: Option<ImageInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct ImageInfo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mimetype: Option<String>,
}

/// `im.ponies.emote_rooms`: room ID → state key → (an empty object, for now).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct EmoteRoomsContent {
    #[serde(default)]
    pub rooms: BTreeMap<String, BTreeMap<String, serde_json::Value>>,
}

// ---------------------------------------------------------------------------
// what the frontend sees
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagePackDto {
    /// Stable across reloads, and what the frontend uses to address a pack:
    /// `user` for the personal one, `<room_id>|<state_key>` for a room's.
    pub id: String,
    /// `user` | `room`
    pub source: &'static str,
    pub room_id: Option<String>,
    pub state_key: Option<String>,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub attribution: Option<String>,
    pub images: Vec<PackImageDto>,
    /// Whether this pack is carried outside the room it belongs to — the
    /// `im.ponies.emote_rooms` list. Always true for the personal pack.
    ///
    /// Not a filter: everything returned here is usable where it was asked for,
    /// including a room's own packs in that room. This says whether it follows
    /// you elsewhere, which is what the settings toggle writes.
    pub everywhere: bool,
    /// Whether this account may write the pack back.
    pub can_edit: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackImageDto {
    /// The `:name:` a person types, without the colons.
    pub shortcode: String,
    pub url: String,
    /// Alt text for the image. Falls back to the shortcode.
    pub body: String,
    pub is_emoticon: bool,
    pub is_sticker: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub size: Option<u64>,
    pub mimetype: Option<String>,
}

/// Read a pack's usage list, which is absent when a pack is good for both.
fn usage_of(usage: Option<&Vec<String>>) -> (bool, bool) {
    match usage {
        None => (true, true),
        Some(list) if list.is_empty() => (true, true),
        Some(list) => (
            list.iter().any(|u| u == "emoticon"),
            list.iter().any(|u| u == "sticker"),
        ),
    }
}

impl ImagePackContent {
    /// Flatten to the frontend's shape.
    ///
    /// An image with no usage of its own inherits the pack's, which is how the
    /// MSC lets a whole pack be declared stickers-only in one line.
    fn to_images(&self) -> Vec<PackImageDto> {
        let pack_usage = self.pack.as_ref().and_then(|p| p.usage.as_ref());

        self.images
            .iter()
            // A URL that isn't an mxc is either a mistake or an attempt to make
            // the client fetch something remote; neither is worth rendering.
            .filter(|(_, image)| image.url.starts_with("mxc://"))
            .map(|(shortcode, image)| {
                let (is_emoticon, is_sticker) =
                    usage_of(image.usage.as_ref().or(pack_usage));

                PackImageDto {
                    shortcode: shortcode.clone(),
                    url: image.url.clone(),
                    body: image.body.clone().unwrap_or_else(|| shortcode.clone()),
                    is_emoticon,
                    is_sticker,
                    width: image.info.as_ref().and_then(|i| i.w),
                    height: image.info.as_ref().and_then(|i| i.h),
                    size: image.info.as_ref().and_then(|i| i.size),
                    mimetype: image.info.as_ref().and_then(|i| i.mimetype.clone()),
                }
            })
            .collect()
    }
}

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

/// The user's own pack, or `None` when they haven't made one.
pub async fn user_pack(core: &MatrixCore) -> Result<Option<ImagePackContent>> {
    let raw = core
        .client
        .account()
        .account_data_raw(USER_EMOTES.into())
        .await?;

    Ok(raw.and_then(|raw| match raw.deserialize_as_unchecked::<ImagePackContent>() {
        Ok(content) => Some(content),
        Err(e) => {
            tracing::warn!("ignoring an unreadable {USER_EMOTES}: {e}");
            None
        }
    }))
}

/// The rooms whose packs the user has enabled everywhere.
pub async fn emote_rooms(core: &MatrixCore) -> Result<EmoteRoomsContent> {
    let raw = core
        .client
        .account()
        .account_data_raw(EMOTE_ROOMS.into())
        .await?;

    Ok(raw
        .and_then(|raw| raw.deserialize_as_unchecked::<EmoteRoomsContent>().ok())
        .unwrap_or_default())
}

/// Every pack in one room, with its state key.
pub async fn room_packs(
    core: &MatrixCore,
    room_id: &RoomId,
) -> Result<Vec<(String, ImagePackContent)>> {
    let Ok(room) = core.room(&room_id.to_owned()) else {
        // A room we've left or never joined isn't an error here — it just has
        // nothing to contribute.
        return Ok(Vec::new());
    };

    let events = room.get_state_events(StateEventType::from(ROOM_EMOTES)).await?;

    let mut out = Vec::new();
    for event in events {
        // Read the raw JSON rather than a typed event: ruma has no type for
        // `im.ponies.room_emotes`, and the state key and content are both right
        // there. A pack whose key we can't read has no stable identity, so it's
        // skipped rather than guessed at.
        let value = match &event {
            RawAnySyncOrStrippedState::Sync(raw) => {
                raw.deserialize_as_unchecked::<serde_json::Value>()
            }
            RawAnySyncOrStrippedState::Stripped(raw) => {
                raw.deserialize_as_unchecked::<serde_json::Value>()
            }
        };
        let Ok(value) = value else { continue };
        let Some(state_key) = value.get("state_key").and_then(|k| k.as_str()) else {
            continue;
        };
        let Some(content) = value.get("content") else { continue };

        match serde_json::from_value::<ImagePackContent>(content.clone()) {
            Ok(pack) if !pack.images.is_empty() => out.push((state_key.to_owned(), pack)),
            Ok(_) => {}
            Err(e) => tracing::warn!("ignoring an unreadable {ROOM_EMOTES} in {room_id}: {e}"),
        }
    }

    Ok(out)
}

/// Every pack available for use right now.
///
/// That's the personal pack, the packs belonging to the room being looked at,
/// and the packs from rooms the user has enabled globally. A room's own packs
/// count there whether or not they've been enabled everywhere — that's the
/// point of them.
///
/// Scanning every joined room instead would mean reading the state of hundreds
/// of rooms to open a picker; the `emote_rooms` list exists precisely so we
/// don't have to.
pub async fn available(core: &MatrixCore, room_id: Option<&RoomId>) -> Result<Vec<ImagePackDto>> {
    let enabled = emote_rooms(core).await?;
    let mut out = Vec::new();

    if let Some(pack) = user_pack(core).await? {
        out.push(to_dto(pack, None, None, true, true));
    }

    // The room in front of the user first, then everything they carry around.
    let mut rooms: Vec<String> = room_id.map(|id| id.to_string()).into_iter().collect();
    for id in enabled.rooms.keys() {
        if !rooms.contains(id) {
            rooms.push(id.clone());
        }
    }

    for room in rooms {
        let Ok(parsed) = RoomId::parse(&room) else { continue };
        let can_edit = can_edit_packs(core, &parsed).await;

        for (state_key, pack) in room_packs(core, &parsed).await? {
            let everywhere = enabled
                .rooms
                .get(&room)
                .is_some_and(|keys| keys.contains_key(&state_key));

            out.push(to_dto(pack, Some(room.clone()), Some(state_key), everywhere, can_edit));
        }
    }

    Ok(out)
}

/// Every pack the settings screen should list.
///
/// Unlike [`available`], this walks every joined room, because the point of the
/// screen is to show packs you *haven't* turned on yet. It's user-initiated and
/// reads from the local store, so the cost lands where someone asked for it.
pub async fn all(core: &MatrixCore) -> Result<Vec<ImagePackDto>> {
    let enabled = emote_rooms(core).await?;
    let mut out = Vec::new();

    out.push(match user_pack(core).await? {
        Some(pack) => to_dto(pack, None, None, true, true),
        // The personal pack is offered even when it doesn't exist yet — an
        // empty card to drop images into is the way you make one.
        None => to_dto(ImagePackContent::default(), None, None, true, true),
    });

    for room in core.client.joined_rooms() {
        let room_id = room.room_id().to_string();
        let can_edit = can_edit_packs(core, room.room_id()).await;

        for (state_key, pack) in room_packs(core, room.room_id()).await? {
            let everywhere = enabled
                .rooms
                .get(&room_id)
                .is_some_and(|keys| keys.contains_key(&state_key));

            out.push(to_dto(pack, Some(room_id.clone()), Some(state_key), everywhere, can_edit));
        }
    }

    Ok(out)
}

/// A room a new pack could go in.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackRoomDto {
    pub id: String,
    pub name: String,
}

/// Rooms this account may write packs in, by name.
///
/// A pack has to live somewhere: the personal one is always available, and a
/// shared one needs a room you have the power level to send state in.
pub async fn editable_rooms(core: &MatrixCore) -> Result<Vec<PackRoomDto>> {
    let mut out = Vec::new();

    for room in core.client.joined_rooms() {
        if room.is_space() || !can_edit_packs(core, room.room_id()).await {
            continue;
        }

        out.push(PackRoomDto {
            id: room.room_id().to_string(),
            name: room
                .cached_display_name()
                .map(|n| n.to_string())
                .unwrap_or_else(|| room.room_id().to_string()),
        });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

/// Replace the personal pack.
pub async fn save_user_pack(core: &MatrixCore, content: ImagePackContent) -> Result<()> {
    use matrix_sdk::ruma::serde::Raw;

    let raw = Raw::new(&content).map_err(|e| Error::Other(e.to_string()))?;
    core.client
        .account()
        .set_account_data_raw(USER_EMOTES.into(), raw.cast_unchecked())
        .await?;
    Ok(())
}

/// Replace one of a room's packs.
///
/// State events can't be deleted, so removing a pack means writing an empty
/// one; readers treat a pack with no images as nothing at all.
pub async fn save_room_pack(
    core: &MatrixCore,
    room_id: &RoomId,
    state_key: &str,
    content: ImagePackContent,
) -> Result<()> {
    let room = core.room(&room_id.to_owned())?;
    let body = serde_json::to_value(&content).map_err(|e| Error::Other(e.to_string()))?;

    room.send_state_event_raw(ROOM_EMOTES, state_key, body).await?;
    Ok(())
}

/// Carry a room's pack everywhere, or stop.
pub async fn set_everywhere(
    core: &MatrixCore,
    room_id: &RoomId,
    state_key: &str,
    on: bool,
) -> Result<()> {
    use matrix_sdk::ruma::serde::Raw;

    let mut content = emote_rooms(core).await?;
    let room = room_id.to_string();

    if on {
        content
            .rooms
            .entry(room)
            .or_default()
            .insert(state_key.to_owned(), serde_json::json!({}));
    } else {
        if let Some(keys) = content.rooms.get_mut(&room) {
            keys.remove(state_key);
        }
        // A room with no packs left shouldn't linger as an empty object.
        content.rooms.retain(|_, keys| !keys.is_empty());
    }

    let raw = Raw::new(&content).map_err(|e| Error::Other(e.to_string()))?;
    core.client
        .account()
        .set_account_data_raw(EMOTE_ROOMS.into(), raw.cast_unchecked())
        .await?;
    Ok(())
}

/// Which pack an edit is aimed at.
///
/// The personal pack has no room; a room pack is a room plus a state key. The
/// frontend addresses packs by their `id`, and this is that id taken apart.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackTarget {
    #[serde(default)]
    pub room_id: Option<String>,
    #[serde(default)]
    pub state_key: Option<String>,
}

/// One change to a pack, applied on top of whatever the server currently has.
///
/// Edits are described rather than sent as a whole pack because two clients
/// touching the same pack shouldn't be able to erase each other's images: every
/// one of these reads first, changes one thing, and writes back.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PackEdit {
    /// Add an image, or replace one already under that shortcode.
    #[serde(rename_all = "camelCase")]
    PutImage {
        shortcode: String,
        url: String,
        #[serde(default)]
        body: Option<String>,
        is_emoticon: bool,
        is_sticker: bool,
        #[serde(default)]
        width: Option<u32>,
        #[serde(default)]
        height: Option<u32>,
        #[serde(default)]
        size: Option<u64>,
        #[serde(default)]
        mimetype: Option<String>,
    },
    /// Move an image to a different shortcode, keeping everything else.
    #[serde(rename_all = "camelCase")]
    Rename { from: String, to: String },
    #[serde(rename_all = "camelCase")]
    RemoveImage { shortcode: String },
    /// Rename the pack itself.
    #[serde(rename_all = "camelCase")]
    SetName { name: String },
}

/// A shortcode people can actually type, and that survives a round trip.
///
/// Colons would make the code unparseable in `:name:` form, and whitespace
/// makes it untypeable; both are rejected rather than silently mangled.
fn check_shortcode(shortcode: &str) -> Result<String> {
    let trimmed = shortcode.trim();

    if trimmed.is_empty() {
        return Err(Error::Other("a shortcode needs a name~".into()));
    }
    if trimmed.contains(':') || trimmed.chars().any(char::is_whitespace) {
        return Err(Error::Other(
            "shortcodes can't contain spaces or colons".into(),
        ));
    }

    Ok(trimmed.to_owned())
}

/// Apply one edit to a pack, reading it first and writing it back.
pub async fn edit(core: &MatrixCore, target: PackTarget, edit: PackEdit) -> Result<()> {
    let room_id = target.room_id.as_deref().map(RoomId::parse).transpose()?;
    let state_key = target.state_key.clone();

    let mut content = one(core, room_id.as_deref(), state_key.as_deref()).await?;

    match edit {
        PackEdit::PutImage {
            shortcode,
            url,
            body,
            is_emoticon,
            is_sticker,
            width,
            height,
            size,
            mimetype,
        } => {
            if !url.starts_with("mxc://") {
                return Err(Error::Other("that image isn't on this server".into()));
            }

            let shortcode = check_shortcode(&shortcode)?;
            let info = ImageInfo { w: width, h: height, size, mimetype };

            content.images.insert(
                shortcode,
                PackImage {
                    url,
                    body: body.filter(|b| !b.trim().is_empty()),
                    info: Some(info),
                    usage: usage_list(is_emoticon, is_sticker),
                },
            );
        }

        PackEdit::Rename { from, to } => {
            let to = check_shortcode(&to)?;
            let Some(image) = content.images.remove(&from) else {
                return Err(Error::Other(format!("there's no :{from}: in this pack")));
            };
            content.images.insert(to, image);
        }

        PackEdit::RemoveImage { shortcode } => {
            content.images.remove(&shortcode);
        }

        PackEdit::SetName { name } => {
            let name = name.trim().to_owned();
            let info = content.pack.get_or_insert_with(PackInfo::default);
            // An empty name isn't stored as one: dropping the field lets the
            // reader fall back to its default rather than showing a blank card.
            info.display_name = (!name.is_empty()).then_some(name);
        }
    }

    match (room_id, state_key) {
        (Some(room), Some(key)) => save_room_pack(core, &room, &key, content).await,
        _ => save_user_pack(core, content).await,
    }
}

/// The MSC's `usage` list, or `None` when an image is good for both.
fn usage_list(is_emoticon: bool, is_sticker: bool) -> Option<Vec<String>> {
    match (is_emoticon, is_sticker) {
        (true, true) => None,
        (true, false) => Some(vec!["emoticon".to_owned()]),
        (false, true) => Some(vec!["sticker".to_owned()]),
        // Neither is not a state the UI offers, and an empty list means "both"
        // to every reader — including ours — so treat it as emoticon-only.
        (false, false) => Some(vec!["emoticon".to_owned()]),
    }
}

/// Read one pack back for editing, so a write is always against what's there.
///
/// Reading first matters: two clients editing the same pack would otherwise
/// have the second overwrite whatever the first added.
pub async fn one(
    core: &MatrixCore,
    room_id: Option<&RoomId>,
    state_key: Option<&str>,
) -> Result<ImagePackContent> {
    match (room_id, state_key) {
        (Some(room), Some(key)) => Ok(room_packs(core, room)
            .await?
            .into_iter()
            .find(|(k, _)| k == key)
            .map(|(_, pack)| pack)
            .unwrap_or_default()),
        _ => Ok(user_pack(core).await?.unwrap_or_default()),
    }
}

/// Whether this account may write a room's packs.
///
/// Defaults to "no" rather than erroring: a room whose power levels we can't
/// read yet should show its packs as read-only, not fail the whole picker.
pub async fn can_edit_packs(core: &MatrixCore, room_id: &RoomId) -> bool {
    let Ok(room) = core.room(&room_id.to_owned()) else { return false };
    let Ok(user_id) = core.own_user_id() else { return false };

    room.power_levels_or_default()
        .await
        .user_can_send_state(&user_id, StateEventType::from(ROOM_EMOTES))
}

fn to_dto(
    content: ImagePackContent,
    room_id: Option<String>,
    state_key: Option<String>,
    everywhere: bool,
    can_edit: bool,
) -> ImagePackDto {
    let images = content.to_images();
    let info = content.pack.unwrap_or_default();

    let id = match (&room_id, &state_key) {
        (Some(room), Some(key)) => format!("{room}|{key}"),
        _ => "user".to_owned(),
    };

    let display_name = info
        .display_name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| match &room_id {
            Some(_) => "room pack".to_owned(),
            None => "your emotes".to_owned(),
        });

    ImagePackDto {
        id,
        source: if room_id.is_some() { "room" } else { "user" },
        room_id,
        state_key,
        display_name,
        avatar_url: info.avatar_url.filter(|url| url.starts_with("mxc://")),
        attribution: info.attribution,
        images,
        everywhere,
        can_edit,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: serde_json::Value) -> ImagePackContent {
        serde_json::from_value(json).expect("valid pack")
    }

    #[test]
    fn an_image_inherits_the_packs_usage() {
        let pack = parse(serde_json::json!({
            "images": { "blobcat": { "url": "mxc://veil.gg/a" } },
            "pack": { "usage": ["sticker"] }
        }));

        let images = pack.to_images();
        assert_eq!(images.len(), 1);
        assert!(images[0].is_sticker);
        assert!(!images[0].is_emoticon);
    }

    #[test]
    fn an_image_can_override_the_packs_usage() {
        let pack = parse(serde_json::json!({
            "images": {
                "blobcat": { "url": "mxc://veil.gg/a", "usage": ["emoticon"] }
            },
            "pack": { "usage": ["sticker"] }
        }));

        assert!(pack.to_images()[0].is_emoticon);
        assert!(!pack.to_images()[0].is_sticker);
    }

    #[test]
    fn no_usage_anywhere_means_both() {
        let pack = parse(serde_json::json!({
            "images": { "blobcat": { "url": "mxc://veil.gg/a" } }
        }));

        assert!(pack.to_images()[0].is_emoticon);
        assert!(pack.to_images()[0].is_sticker);
    }

    #[test]
    fn a_remote_url_is_dropped_rather_than_fetched() {
        let pack = parse(serde_json::json!({
            "images": {
                "tracker": { "url": "https://evil.example/pixel.gif" },
                "blobcat": { "url": "mxc://veil.gg/a" }
            }
        }));

        let codes: Vec<_> = pack.to_images().into_iter().map(|i| i.shortcode).collect();
        assert_eq!(codes, ["blobcat"]);
    }

    #[test]
    fn the_shortcode_stands_in_for_a_missing_body() {
        let pack = parse(serde_json::json!({
            "images": { "blobcat": { "url": "mxc://veil.gg/a" } }
        }));

        assert_eq!(pack.to_images()[0].body, "blobcat");
    }

    #[test]
    fn unknown_fields_dont_sink_a_pack() {
        // Other clients write things we've never heard of; a pack that carries
        // one is still a pack.
        let pack = parse(serde_json::json!({
            "images": {
                "blobcat": { "url": "mxc://veil.gg/a", "something_new": 42 }
            },
            "pack": { "display_name": "blobs", "future_field": true }
        }));

        assert_eq!(pack.to_images().len(), 1);
        assert_eq!(pack.pack.unwrap().display_name.unwrap(), "blobs");
    }

    #[test]
    fn usage_round_trips_through_the_msc_list() {
        // Both is the absence of a list, which is what every other client
        // writes and what our own reader treats as "usable anywhere".
        assert_eq!(usage_list(true, true), None);
        assert_eq!(usage_of(usage_list(true, true).as_ref()), (true, true));

        assert_eq!(usage_list(true, false), Some(vec!["emoticon".to_owned()]));
        assert_eq!(usage_of(usage_list(true, false).as_ref()), (true, false));

        assert_eq!(usage_list(false, true), Some(vec!["sticker".to_owned()]));
        assert_eq!(usage_of(usage_list(false, true).as_ref()), (false, true));
    }

    #[test]
    fn neither_usage_is_not_stored_as_an_empty_list() {
        // An empty list reads back as "both" everywhere, which would turn an
        // image the user disabled into one that's on in two places.
        let list = usage_list(false, false);
        assert_ne!(list, Some(Vec::new()));
        assert_eq!(usage_of(list.as_ref()), (true, false));
    }

    #[test]
    fn a_shortcode_has_to_be_typeable() {
        assert_eq!(check_shortcode("  blobcat ").unwrap(), "blobcat");

        for bad in ["", "   ", "blob cat", "blob:cat", ":blobcat:"] {
            assert!(check_shortcode(bad).is_err(), "{bad:?} should be refused");
        }
    }

    #[test]
    fn a_pack_with_no_name_gets_one() {
        let dto = to_dto(ImagePackContent::default(), None, None, true, true);
        assert_eq!(dto.display_name, "your emotes");

        let dto = to_dto(
            ImagePackContent::default(),
            Some("!r:veil.gg".to_owned()),
            Some(String::new()),
            false,
            false,
        );
        assert_eq!(dto.display_name, "room pack");
        assert_eq!(dto.id, "!r:veil.gg|");
    }
}
