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

use crate::{error::Result, matrix::MatrixCore};

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
