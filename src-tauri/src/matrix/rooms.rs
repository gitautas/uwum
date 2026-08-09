//! Room summaries and the stream that keeps the sidebar current.

use std::sync::Arc;

use futures_util::{StreamExt, pin_mut};
use matrix_sdk::{
    Room, RoomMemberships, RoomState,
    ruma::{
        RoomId,
        events::room::{member::MembershipState, power_levels::UserPowerLevel},
    },
};
use matrix_sdk_ui::room_list_service::filters;
use tauri::{AppHandle, Emitter};
use tokio::task::JoinHandle;

use crate::{
    dto::{Diff, LatestEvent, RoomMemberDto, RoomSummary, SpaceSummary},
    error::{Error, Result},
    events::EV_ROOMS,
    matrix::MatrixCore,
};

/// How many rooms the sliding-sync window holds at once. Large enough that a
/// normal account is fully loaded on first paint, small enough to stay cheap.
const ROOM_PAGE_SIZE: usize = 300;

/// Spell out the membership rather than `Debug`-formatting it: the frontend
/// branches on these strings, so they're an API, not a debugging aid.
fn membership_state_str(state: &MembershipState) -> &'static str {
    match state {
        MembershipState::Join => "join",
        MembershipState::Invite => "invite",
        MembershipState::Leave => "leave",
        MembershipState::Ban => "ban",
        MembershipState::Knock => "knock",
        _ => "unknown",
    }
}

pub fn membership_str(state: RoomState) -> &'static str {
    match state {
        RoomState::Joined => "joined",
        RoomState::Left => "left",
        RoomState::Invited => "invited",
        RoomState::Knocked => "knocked",
        RoomState::Banned => "banned",
    }
}

/// Pull a preview line out of a room's latest event.
///
/// We read the raw JSON rather than matching every event type: the sidebar only
/// needs one line of text, and a preview is never worth failing a room summary
/// over.
async fn latest_event(room: &Room) -> Option<LatestEvent> {
    use matrix_sdk_base::latest_event::LatestEventValue;

    let value = room.latest_event();
    let timestamp = value.timestamp().map(|t| t.0.into()).unwrap_or(0);

    let (sender, body) = match &value {
        LatestEventValue::Remote(event) => {
            let json: serde_json::Value = event.raw().deserialize_as_unchecked().ok()?;
            let sender = json.get("sender")?.as_str()?.to_owned();
            let body = preview_from_content(&json)?;
            (sender, body)
        }
        LatestEventValue::LocalIsSending(local)
        | LatestEventValue::LocalCannotBeSent(local)
        | LatestEventValue::LocalHasBeenSent { value: local, .. } => {
            let content = local.content.deserialize().ok()?;
            let json = serde_json::to_value(&content).ok()?;
            let body = preview_from_content(&serde_json::json!({ "content": json }))
                .unwrap_or_else(|| "…".to_owned());
            (room.own_user_id().to_string(), body)
        }
        LatestEventValue::RemoteInvite { inviter, .. } => (
            inviter.as_ref().map(|u| u.to_string()).unwrap_or_default(),
            "invited you".to_owned(),
        ),
        LatestEventValue::None => return None,
    };

    let sender_name = match matrix_sdk::ruma::UserId::parse(&sender) {
        Ok(user_id) => room
            .get_member_no_sync(&user_id)
            .await
            .ok()
            .flatten()
            .and_then(|m| m.display_name().map(str::to_owned)),
        Err(_) => None,
    };

    Some(LatestEvent { sender, sender_name, body, timestamp })
}

fn preview_from_content(json: &serde_json::Value) -> Option<String> {
    let content = json.get("content")?;
    if let Some(body) = content.get("body").and_then(|b| b.as_str()) {
        return Some(body.chars().take(140).collect());
    }
    match json.get("type").and_then(|t| t.as_str()) {
        Some("m.room.encrypted") => Some("encrypted message".to_owned()),
        Some("m.sticker") => Some("sticker".to_owned()),
        Some("m.room.member") => Some("membership change".to_owned()),
        Some(other) => Some(other.to_owned()),
        None => None,
    }
}

pub async fn summarise(room: &Room) -> Result<RoomSummary> {
    let counts = room.unread_notification_counts();
    let notification_count = counts.notification_count;
    let highlight_count = counts.highlight_count;
    let is_marked_unread = room.is_marked_unread();

    let name = match room.cached_display_name() {
        Some(name) => name.to_string(),
        None => room
            .display_name()
            .await
            .map(|n| n.to_string())
            .unwrap_or_else(|_| room.room_id().to_string()),
    };

    // `is_direct` hits the store, and a store hiccup shouldn't sink the whole
    // summary — a room that's wrongly grouped is better than a missing room.
    let is_direct = room.is_direct().await.unwrap_or(false);

    let muted = matches!(
        room.cached_user_defined_notification_mode(),
        Some(matrix_sdk::notification_settings::RoomNotificationMode::Mute)
    );

    let parent_spaces = collect_parent_spaces(room).await;

    Ok(RoomSummary {
        id: room.room_id().to_string(),
        name,
        topic: room.topic(),
        canonical_alias: room.canonical_alias().map(|a| a.to_string()),
        avatar_url: room.avatar_url().map(|u| u.to_string()),
        is_direct,
        is_encrypted: room.encryption_state().is_encrypted(),
        is_space: room.is_space(),
        is_favourite: room.is_favourite(),
        is_low_priority: room.is_low_priority(),
        is_muted: muted,
        membership: membership_str(room.state()).to_owned(),
        notification_count,
        highlight_count,
        has_unread: notification_count > 0 || highlight_count > 0 || is_marked_unread,
        is_marked_unread,
        member_count: room.joined_members_count(),
        latest: latest_event(room).await,
        recency: room.recency_stamp().map(|s| s.into()).unwrap_or(0),
        parent_spaces,
        has_active_call: room.has_active_room_call(),
        is_video_room: room.is_call(),
    })
}

async fn collect_parent_spaces(room: &Room) -> Vec<String> {
    use matrix_sdk::room::ParentSpace;

    let Ok(stream) = room.parent_spaces().await else {
        return Vec::new();
    };
    pin_mut!(stream);

    let mut out = Vec::new();
    while let Some(Ok(parent)) = stream.next().await {
        let id = match parent {
            ParentSpace::Reciprocal(space) | ParentSpace::WithPowerlevel(space) => {
                space.room_id().to_owned()
            }
            ParentSpace::Illegitimate(space) => space.room_id().to_owned(),
            ParentSpace::Unverifiable(room_id) => room_id,
        };
        out.push(id.to_string());
    }
    out
}

/// Stream room-list changes to the frontend as diffs.
///
/// The sliding-sync list yields `VectorDiff`s; we translate each one and pass it
/// through so the UI mutates its list in place. A full `Reset` arrives first,
/// and again whenever the filter changes.
pub fn spawn_room_list_task(app: AppHandle, core: Arc<MatrixCore>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let all_rooms = match core.room_list.all_rooms().await {
            Ok(rooms) => rooms,
            Err(e) => {
                tracing::error!("couldn't open the room list: {e}");
                return;
            }
        };

        let (stream, controller) = all_rooms.entries_with_dynamic_adapters(ROOM_PAGE_SIZE);
        // Nothing is emitted until a filter is set. "Everything we haven't left"
        // is the list the sidebar wants; joined/invited splitting happens in the UI.
        controller.set_filter(Box::new(filters::new_filter_non_left()));

        pin_mut!(stream);

        while let Some(diffs) = stream.next().await {
            if core.shutting_down.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }

            let mut converted = Vec::with_capacity(diffs.len());
            for diff in diffs {
                converted.push(convert_room_diff(diff).await);
            }

            // Keep the mirror in step before emitting, so a `get_rooms` racing
            // with this update sees the same list the event describes.
            {
                let mut mirror = core.rooms.lock().await;
                for diff in &converted {
                    apply_diff(&mut mirror, diff);
                }
            }

            if let Err(e) = app.emit(EV_ROOMS, &converted) {
                tracing::warn!("couldn't emit room list update: {e}");
            }
        }
    })
}

/// Replay a diff onto the mirror. Index-bearing operations are bounds-checked:
/// a malformed diff should leave the mirror stale, never panic the sync task.
fn apply_diff(list: &mut Vec<RoomSummary>, diff: &Diff<RoomSummary>) {
    match diff {
        Diff::Append { values } => list.extend(values.iter().cloned()),
        Diff::Clear => list.clear(),
        Diff::PushFront { value } => list.insert(0, value.clone()),
        Diff::PushBack { value } => list.push(value.clone()),
        Diff::PopFront => {
            if !list.is_empty() {
                list.remove(0);
            }
        }
        Diff::PopBack => {
            list.pop();
        }
        Diff::Insert { index, value } if *index <= list.len() => {
            list.insert(*index, value.clone())
        }
        Diff::Set { index, value } if *index < list.len() => list[*index] = value.clone(),
        Diff::Remove { index } if *index < list.len() => {
            list.remove(*index);
        }
        Diff::Truncate { length } => list.truncate(*length),
        Diff::Reset { values } => *list = values.clone(),
        other => tracing::warn!("out-of-range room diff ignored: {other:?}"),
    }
}

async fn summarise_or_placeholder(room: &Room) -> RoomSummary {
    match summarise(room).await {
        Ok(summary) => summary,
        Err(e) => {
            tracing::warn!("couldn't summarise {}: {e}", room.room_id());
            RoomSummary {
                id: room.room_id().to_string(),
                name: room.room_id().to_string(),
                topic: None,
                canonical_alias: None,
                avatar_url: None,
                is_direct: false,
                is_encrypted: false,
                is_space: false,
                is_favourite: false,
                is_low_priority: false,
                is_muted: false,
                membership: membership_str(room.state()).to_owned(),
                notification_count: 0,
                highlight_count: 0,
                has_unread: false,
                is_marked_unread: false,
                member_count: 0,
                latest: None,
                recency: 0,
                parent_spaces: Vec::new(),
                has_active_call: false,
                is_video_room: false,
            }
        }
    }
}

async fn summarise_all(rooms: Vec<impl std::ops::Deref<Target = Room>>) -> Vec<RoomSummary> {
    let mut out = Vec::with_capacity(rooms.len());
    for room in rooms {
        out.push(summarise_or_placeholder(&room).await);
    }
    out
}

async fn convert_room_diff(
    diff: matrix_sdk_ui::eyeball_im::VectorDiff<matrix_sdk_ui::room_list_service::RoomListItem>,
) -> Diff<RoomSummary> {
    use matrix_sdk_ui::eyeball_im::VectorDiff;

    match diff {
        VectorDiff::Append { values } => {
            Diff::Append { values: summarise_all(values.into_iter().collect()).await }
        }
        VectorDiff::Clear => Diff::Clear,
        VectorDiff::PushFront { value } => {
            Diff::PushFront { value: summarise_or_placeholder(&value).await }
        }
        VectorDiff::PushBack { value } => {
            Diff::PushBack { value: summarise_or_placeholder(&value).await }
        }
        VectorDiff::PopFront => Diff::PopFront,
        VectorDiff::PopBack => Diff::PopBack,
        VectorDiff::Insert { index, value } => {
            Diff::Insert { index, value: summarise_or_placeholder(&value).await }
        }
        VectorDiff::Set { index, value } => {
            Diff::Set { index, value: summarise_or_placeholder(&value).await }
        }
        VectorDiff::Remove { index } => Diff::Remove { index },
        VectorDiff::Truncate { length } => Diff::Truncate { length },
        VectorDiff::Reset { values } => {
            Diff::Reset { values: summarise_all(values.into_iter().collect()).await }
        }
    }
}

// ---------------------------------------------------------------------------
// one-shot queries
// ---------------------------------------------------------------------------

pub async fn members(core: &MatrixCore, room_id: &RoomId) -> Result<Vec<RoomMemberDto>> {
    let room = core
        .client
        .get_room(room_id)
        .ok_or_else(|| Error::UnknownRoom(room_id.to_string()))?;

    // The member list is lazily loaded; make sure we have it before reading.
    if !room.are_members_synced() {
        room.sync_members().await?;
    }

    let members = room.members(RoomMemberships::ACTIVE).await?;
    let encryption = core.client.encryption();

    let mut out = Vec::with_capacity(members.len());
    for member in members {
        // Cross-signing state is per-user and needs a store read, so a failure
        // degrades to "unknown" rather than dropping the member.
        let verification = match encryption.get_user_identity(member.user_id()).await {
            Ok(Some(identity)) if identity.is_verified() => "verified",
            Ok(Some(_)) => "unverified",
            _ => "unknown",
        };

        out.push(RoomMemberDto {
            user_id: member.user_id().to_string(),
            display_name: member.display_name().map(str::to_owned),
            avatar_url: member.avatar_url().map(|u| u.to_string()),
            // Room creators have "infinite" power from room version 12; clamp
            // so the value stays sortable alongside ordinary integer levels.
            power_level: match member.power_level() {
                UserPowerLevel::Infinite => i64::MAX,
                UserPowerLevel::Int(v) => v.into(),
                // `UserPowerLevel` is non-exhaustive; treat anything new as an
                // ordinary member rather than guessing at its authority.
                _ => 0,
            },
            membership: membership_state_str(member.membership()).to_owned(),
            is_ignored: member.is_ignored(),
            verification: verification.to_owned(),
        });
    }

    // Power level descending, then name — the ordering the design's member list uses.
    out.sort_by(|a, b| {
        b.power_level
            .cmp(&a.power_level)
            .then_with(|| a.display_name.cmp(&b.display_name))
    });

    Ok(out)
}

/// Spaces the user is in, with the rooms each one contains.
pub async fn spaces(core: &MatrixCore) -> Result<Vec<SpaceSummary>> {
    let mut out = Vec::new();

    for room in core.client.joined_rooms() {
        if !room.is_space() {
            continue;
        }

        let children = space_children(&room).await;
        let counts = room.unread_notification_counts();

        out.push(SpaceSummary {
            id: room.room_id().to_string(),
            name: room
                .cached_display_name()
                .map(|n| n.to_string())
                .unwrap_or_else(|| room.room_id().to_string()),
            avatar_url: room.avatar_url().map(|u| u.to_string()),
            children,
            notification_count: counts.notification_count,
            highlight_count: counts.highlight_count,
        });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

async fn space_children(space: &Room) -> Vec<String> {
    use matrix_sdk::ruma::events::space::child::SpaceChildEventContent;

    let Ok(events) = space.get_state_events_static::<SpaceChildEventContent>().await else {
        return Vec::new();
    };

    events
        .into_iter()
        .filter_map(|raw| {
            let event = raw.deserialize().ok()?;
            let state_key = event.state_key().to_owned();

            // Spec says a child whose content is empty has been removed from the
            // space. We only check that the event still has content rather than
            // insisting on a non-empty `via`: not every server round-trips that
            // field, and dropping a real child leaves the space looking empty —
            // a much worse failure than keeping a stale one.
            let is_present = event.as_sync().is_some_and(|sync| sync.as_original().is_some());
            is_present.then_some(state_key.to_string())
        })
        .collect()
}

// ---------------------------------------------------------------------------
// room actions
// ---------------------------------------------------------------------------

pub async fn join(core: &MatrixCore, alias_or_id: &str) -> Result<String> {
    let room_id = super::auth::resolve_room(&core.client, alias_or_id).await?;
    let room = core.client.join_room_by_id(&room_id).await?;
    Ok(room.room_id().to_string())
}

pub async fn leave(core: &MatrixCore, room_id: &RoomId) -> Result<()> {
    core.room(&room_id.to_owned())?.leave().await?;
    Ok(())
}

pub async fn set_typing(core: &MatrixCore, room_id: &RoomId, typing: bool) -> Result<()> {
    core.room(&room_id.to_owned())?.typing_notice(typing).await?;
    Ok(())
}

pub async fn set_favourite(core: &MatrixCore, room_id: &RoomId, favourite: bool) -> Result<()> {
    core.room(&room_id.to_owned())?.set_is_favourite(favourite, None).await?;
    Ok(())
}

pub async fn set_low_priority(core: &MatrixCore, room_id: &RoomId, low: bool) -> Result<()> {
    core.room(&room_id.to_owned())?.set_is_low_priority(low, None).await?;
    Ok(())
}

pub async fn set_marked_unread(core: &MatrixCore, room_id: &RoomId, unread: bool) -> Result<()> {
    core.room(&room_id.to_owned())?.set_unread_flag(unread).await?;
    Ok(())
}

pub async fn set_muted(core: &MatrixCore, room_id: &RoomId, muted: bool) -> Result<()> {
    use matrix_sdk::notification_settings::RoomNotificationMode;

    let settings = core.client.notification_settings().await;
    if muted {
        settings.set_room_notification_mode(room_id, RoomNotificationMode::Mute).await
    } else {
        settings.delete_user_defined_room_rules(room_id).await
    }
    .map_err(|e| Error::Other(e.to_string()))
}

pub async fn invite(core: &MatrixCore, room_id: &RoomId, user_id: &str) -> Result<()> {
    let user_id = matrix_sdk::ruma::UserId::parse(user_id)?;
    core.room(&room_id.to_owned())?.invite_user_by_id(&user_id).await?;
    Ok(())
}
