//! Open timelines, stream their diffs, and act on individual events.
//!
//! A timeline is opened when the user selects a room and closed when they leave
//! it. Threads get their own timeline keyed by `<room_id>|<thread_root>`, so a
//! thread panel and the main timeline can be open side by side.

use std::sync::Arc;

use futures_util::{StreamExt, pin_mut};
use matrix_sdk::{
    room::edit::EditedContent,
    ruma::{
        EventId, OwnedEventId, RoomId,
        events::{
            room::message::{
                MessageType, RoomMessageEventContent, RoomMessageEventContentWithoutRelation,
                TextMessageEventContent,
            },
        },
    },
};
use matrix_sdk_ui::timeline::{
    RoomExt, TimelineEventItemId, TimelineFocus, TimelineItem, TimelineReadReceiptTracking,
};
use tauri::AppHandle;

use crate::{
    dto::{Diff, SendOptions, TimelineItemDto, TimelineUpdate, convert_timeline_item},
    error::{Error, Result},
    events::{EV_TIMELINE, emit, spawn_typing_task},
    matrix::{MatrixCore, core::OpenTimeline},
};

/// How many events a single "load older messages" step fetches.
pub const PAGE_SIZE: u16 = 40;

/// Key under which a timeline is stored. Threads are namespaced under their room.
pub fn timeline_key(room_id: &RoomId, thread_root: Option<&str>) -> String {
    match thread_root {
        Some(root) => format!("{room_id}|{root}"),
        None => room_id.to_string(),
    }
}

/// Open (or return the already-open) timeline for a room or thread.
///
/// Returns the current items so the UI can paint immediately; subsequent
/// changes arrive as `matrix://timeline` diffs.
pub async fn open(
    app: &AppHandle,
    core: &Arc<MatrixCore>,
    room_id: &RoomId,
    thread_root: Option<String>,
) -> Result<Vec<TimelineItemDto>> {
    let key = timeline_key(room_id, thread_root.as_deref());
    let own_user = core.own_user_id()?;

    // Re-opening a timeline we already have is a no-op apart from re-reading the
    // current items: the stream task is still running and still emitting.
    if let Some(open) = core.timelines.lock().await.get(&key) {
        let items = open.timeline.items().await;
        return Ok(items.iter().map(|i| convert_timeline_item(i, &own_user)).collect());
    }

    // Sliding sync only carries ONE event per room in the list — that's the
    // sidebar preview, not a timeline. Subscribing tells the server this is the
    // room we're actually looking at, which raises the limit and pulls the
    // required state. Without this a freshly-restored session opens every room
    // showing a single message.
    core.room_list.subscribe_to_rooms(&[room_id]).await;

    let room = core.room(&room_id.to_owned())?;

    let focus = match &thread_root {
        Some(root) => TimelineFocus::Thread { root_event_id: EventId::parse(root)? },
        // Threaded replies are hidden from the live timeline because we surface
        // them through the thread summary chip instead, as the design does.
        None => TimelineFocus::Live { hide_threaded_events: true },
    };

    let timeline = room
        .timeline_builder()
        .with_focus(focus)
        .track_read_marker_and_receipts(TimelineReadReceiptTracking::MessageLikeEvents)
        .build()
        .await?;
    let timeline = Arc::new(timeline);

    // Member profiles power avatars and display names on every message; without
    // this the first paint shows raw user IDs.
    timeline.fetch_members().await;

    let (initial, stream) = timeline.subscribe().await;

    let task = {
        let app = app.clone();
        let core = core.clone();
        let key = key.clone();

        tokio::spawn(async move {
            pin_mut!(stream);
            while let Some(diffs) = stream.next().await {
                if core.shutting_down.load(std::sync::atomic::Ordering::SeqCst) {
                    break;
                }
                let converted: Vec<_> =
                    diffs.into_iter().map(|d| convert_diff(d, &own_user)).collect();

                emit(
                    &app,
                    EV_TIMELINE,
                    TimelineUpdate { room_id: key.clone(), diffs: converted },
                );
            }
        })
    };

    let own_user = core.own_user_id()?;
    let items: Vec<_> = initial.iter().map(|i| convert_timeline_item(i, &own_user)).collect();

    core.timelines.lock().await.insert(key, OpenTimeline { timeline, task });

    // Typing notices only matter for the room the user is actually looking at.
    if thread_root.is_none()
        && let Some(handle) = spawn_typing_task(app.clone(), core.clone(), room_id.to_owned())
    {
        core.tasks.lock().await.push(handle);
    }

    Ok(items)
}

pub async fn close(core: &MatrixCore, room_id: &RoomId, thread_root: Option<&str>) -> Result<()> {
    let key = timeline_key(room_id, thread_root);
    // Dropping `OpenTimeline` aborts its stream task.
    core.timelines.lock().await.remove(&key);
    Ok(())
}

async fn get(
    core: &MatrixCore,
    room_id: &RoomId,
    thread_root: Option<&str>,
) -> Result<Arc<matrix_sdk_ui::Timeline>> {
    let key = timeline_key(room_id, thread_root);
    core.timelines
        .lock()
        .await
        .get(&key)
        .map(|open| open.timeline.clone())
        .ok_or_else(|| Error::NoTimeline(key))
}

fn convert_diff(
    diff: matrix_sdk_ui::eyeball_im::VectorDiff<Arc<TimelineItem>>,
    own_user: &matrix_sdk::ruma::OwnedUserId,
) -> Diff<TimelineItemDto> {
    use matrix_sdk_ui::eyeball_im::VectorDiff;

    let convert = |item: Arc<TimelineItem>| convert_timeline_item(&item, own_user);

    match diff {
        VectorDiff::Append { values } => {
            Diff::Append { values: values.into_iter().map(convert).collect() }
        }
        VectorDiff::Clear => Diff::Clear,
        VectorDiff::PushFront { value } => Diff::PushFront { value: convert(value) },
        VectorDiff::PushBack { value } => Diff::PushBack { value: convert(value) },
        VectorDiff::PopFront => Diff::PopFront,
        VectorDiff::PopBack => Diff::PopBack,
        VectorDiff::Insert { index, value } => Diff::Insert { index, value: convert(value) },
        VectorDiff::Set { index, value } => Diff::Set { index, value: convert(value) },
        VectorDiff::Remove { index } => Diff::Remove { index },
        VectorDiff::Truncate { length } => Diff::Truncate { length },
        VectorDiff::Reset { values } => {
            Diff::Reset { values: values.into_iter().map(convert).collect() }
        }
    }
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

fn build_message(options: &SendOptions) -> RoomMessageEventContent {
    let body = &options.body;

    match options.msgtype.as_deref() {
        Some("m.emote") => {
            if options.markdown {
                RoomMessageEventContent::emote_markdown(body)
            } else {
                RoomMessageEventContent::emote_plain(body)
            }
        }
        Some("m.notice") => {
            if options.markdown {
                RoomMessageEventContent::notice_markdown(body)
            } else {
                RoomMessageEventContent::notice_plain(body)
            }
        }
        _ => {
            if options.markdown {
                RoomMessageEventContent::text_markdown(body)
            } else {
                RoomMessageEventContent::text_plain(body)
            }
        }
    }
}

pub async fn send(
    core: &MatrixCore,
    room_id: &RoomId,
    options: SendOptions,
) -> Result<()> {
    let timeline = get(core, room_id, options.thread_root.as_deref()).await?;
    let content = build_message(&options);

    match &options.reply_to {
        Some(event_id) => {
            let event_id = EventId::parse(event_id)?;
            timeline
                .send_reply(
                    RoomMessageEventContentWithoutRelation::new(content.msgtype),
                    event_id,
                )
                .await?;
        }
        None => {
            timeline.send(content.into()).await?;
        }
    }

    Ok(())
}

pub async fn paginate_back(
    core: &MatrixCore,
    room_id: &RoomId,
    thread_root: Option<&str>,
) -> Result<bool> {
    let timeline = get(core, room_id, thread_root).await?;
    // `true` means we've hit the start of the timeline.
    let reached_start = timeline.paginate_backwards(PAGE_SIZE).await?;
    Ok(reached_start)
}

pub async fn toggle_reaction(
    core: &MatrixCore,
    room_id: &RoomId,
    thread_root: Option<&str>,
    event_id: &str,
    key: &str,
) -> Result<bool> {
    let timeline = get(core, room_id, thread_root).await?;
    let item_id = TimelineEventItemId::EventId(EventId::parse(event_id)?);
    Ok(timeline.toggle_reaction(&item_id, key).await?)
}

pub async fn edit(
    core: &MatrixCore,
    room_id: &RoomId,
    thread_root: Option<&str>,
    event_id: &str,
    new_body: &str,
    markdown: bool,
) -> Result<()> {
    let timeline = get(core, room_id, thread_root).await?;
    let item_id = TimelineEventItemId::EventId(EventId::parse(event_id)?);

    let content = if markdown {
        RoomMessageEventContent::text_markdown(new_body)
    } else {
        RoomMessageEventContent::text_plain(new_body)
    };

    timeline
        .edit(
            &item_id,
            EditedContent::RoomMessage(RoomMessageEventContentWithoutRelation::new(
                content.msgtype,
            )),
        )
        .await?;
    Ok(())
}

pub async fn redact(
    core: &MatrixCore,
    room_id: &RoomId,
    thread_root: Option<&str>,
    event_id: &str,
    reason: Option<&str>,
) -> Result<()> {
    let timeline = get(core, room_id, thread_root).await?;
    let item_id = TimelineEventItemId::EventId(EventId::parse(event_id)?);
    timeline.redact(&item_id, reason).await?;
    Ok(())
}

/// Mark everything up to the newest event as read.
pub async fn mark_as_read(core: &MatrixCore, room_id: &RoomId) -> Result<()> {
    use matrix_sdk::ruma::api::client::receipt::create_receipt::v3::ReceiptType;

    let timeline = get(core, room_id, None).await?;
    timeline.mark_as_read(ReceiptType::Read).await?;
    Ok(())
}

/// Send a read receipt for one specific event.
pub async fn send_read_receipt(
    core: &MatrixCore,
    room_id: &RoomId,
    event_id: &str,
) -> Result<()> {
    use matrix_sdk::ruma::api::client::receipt::create_receipt::v3::ReceiptType;

    let timeline = get(core, room_id, None).await?;
    let event_id: OwnedEventId = EventId::parse(event_id)?;
    timeline.send_single_receipt(ReceiptType::Read, event_id).await?;
    Ok(())
}

/// Upload and send a file. `body` becomes the filename shown in the timeline.
pub async fn send_attachment(
    core: &MatrixCore,
    room_id: &RoomId,
    thread_root: Option<&str>,
    path: &str,
    caption: Option<String>,
) -> Result<()> {
    use matrix_sdk_ui::timeline::AttachmentConfig;

    let timeline = get(core, room_id, thread_root).await?;
    let path = std::path::PathBuf::from(path);

    let mime = mime_guess::from_path(&path).first_or_octet_stream();
    let config = AttachmentConfig {
        caption: caption.map(TextMessageEventContent::plain),
        ..Default::default()
    };

    timeline
        .send_attachment(path, mime, config)
        .use_send_queue()
        .await
        .map_err(|e| Error::Other(format!("upload failed: {e}")))?;
    Ok(())
}

/// The set of events currently pinned in a room, newest first.
pub async fn pinned_events(core: &MatrixCore, room_id: &RoomId) -> Result<Vec<TimelineItemDto>> {
    let room = core.room(&room_id.to_owned())?;
    let own_user = core.own_user_id()?;

    let timeline = room
        .timeline_builder()
        .with_focus(TimelineFocus::PinnedEvents)
        .build()
        .await?;

    let items = timeline.items().await;
    Ok(items.iter().map(|i| convert_timeline_item(i, &own_user)).collect())
}

/// The plain-text body of an event, for building reply previews in the composer.
pub async fn event_body(
    core: &MatrixCore,
    room_id: &RoomId,
    event_id: &str,
) -> Result<Option<String>> {
    let timeline = get(core, room_id, None).await?;
    let event_id = EventId::parse(event_id)?;

    let Some(item) = timeline.item_by_event_id(&event_id).await else {
        return Ok(None);
    };

    use matrix_sdk_ui::timeline::{MsgLikeKind, TimelineItemContent};
    let body = match item.content() {
        TimelineItemContent::MsgLike(msg) => match &msg.kind {
            MsgLikeKind::Message(m) => Some(match m.msgtype() {
                MessageType::Text(t) => t.body.clone(),
                other => other.body().to_owned(),
            }),
            _ => None,
        },
        _ => None,
    };
    Ok(body)
}
