//! Every Tauri command the frontend can call.
//!
//! These are deliberately thin: parse and validate arguments, then delegate.
//! Anything with real logic lives in `matrix::*`, `rtc` or `verification`.

use matrix_sdk::ruma::{OwnedRoomId, RoomId};
use tauri::{AppHandle, Manager, State};

use crate::{
    dto::{
        HomeserverInfo, RoomMemberDto, RoomSummary, SendOptions, SessionInfo, SpaceSummary,
        TimelineItemDto,
    },
    error::{Error, Result},
    matrix::{auth, core::AppState, media, rooms, timeline},
    rtc, verification,
};

/// Where the session pointer and the encrypted stores live.
fn data_dir(app: &AppHandle) -> Result<std::path::PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| Error::Other(format!("no app data directory: {e}")))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn parse_room_id(raw: &str) -> Result<OwnedRoomId> {
    RoomId::parse(raw).map_err(Error::Id)
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn discover_homeserver(server: String) -> Result<HomeserverInfo> {
    auth::discover(&server).await
}

#[tauri::command]
pub async fn login_password(
    app: AppHandle,
    state: State<'_, AppState>,
    server: String,
    username: String,
    password: String,
) -> Result<SessionInfo> {
    let dir = data_dir(&app)?;
    auth::login_password(app.clone(), &state, &dir, &server, &username, &password).await
}

#[tauri::command]
pub async fn login_sso(
    app: AppHandle,
    state: State<'_, AppState>,
    server: String,
    provider_id: Option<String>,
) -> Result<SessionInfo> {
    let dir = data_dir(&app)?;
    auth::login_sso(app.clone(), &state, &dir, &server, provider_id).await
}

#[tauri::command]
pub async fn restore_session(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<SessionInfo>> {
    let dir = data_dir(&app)?;
    auth::restore(app.clone(), &state, &dir).await
}

#[tauri::command]
pub async fn logout(app: AppHandle, state: State<'_, AppState>, wipe: bool) -> Result<()> {
    let dir = data_dir(&app)?;
    auth::logout(&state, &dir, wipe).await
}

#[tauri::command]
pub async fn current_session(state: State<'_, AppState>) -> Result<Option<SessionInfo>> {
    match state.core.read().await.clone() {
        Some(core) => Ok(Some(core.session_info().await?)),
        None => Ok(None),
    }
}

// ---------------------------------------------------------------------------
// rooms
// ---------------------------------------------------------------------------

/// The current room list.
///
/// Sync begins when the session is restored, so the initial push can land
/// before the UI is listening. The UI calls this once it has subscribed, and
/// applies diffs from then on.
#[tauri::command]
pub async fn get_rooms(state: State<'_, AppState>) -> Result<Vec<RoomSummary>> {
    Ok(state.core().await?.rooms.lock().await.clone())
}

#[tauri::command]
pub async fn get_spaces(state: State<'_, AppState>) -> Result<Vec<SpaceSummary>> {
    rooms::spaces(&*state.core().await?).await
}

#[tauri::command]
pub async fn get_members(
    state: State<'_, AppState>,
    room_id: String,
) -> Result<Vec<RoomMemberDto>> {
    rooms::members(&*state.core().await?, &parse_room_id(&room_id)?).await
}

#[tauri::command]
pub async fn join_room(state: State<'_, AppState>, alias_or_id: String) -> Result<String> {
    rooms::join(&*state.core().await?, &alias_or_id).await
}

#[tauri::command]
pub async fn leave_room(state: State<'_, AppState>, room_id: String) -> Result<()> {
    rooms::leave(&*state.core().await?, &parse_room_id(&room_id)?).await
}

#[tauri::command]
pub async fn invite_user(
    state: State<'_, AppState>,
    room_id: String,
    user_id: String,
) -> Result<()> {
    rooms::invite(&*state.core().await?, &parse_room_id(&room_id)?, &user_id).await
}

#[tauri::command]
pub async fn set_typing(
    state: State<'_, AppState>,
    room_id: String,
    typing: bool,
) -> Result<()> {
    rooms::set_typing(&*state.core().await?, &parse_room_id(&room_id)?, typing).await
}

#[tauri::command]
pub async fn set_room_favourite(
    state: State<'_, AppState>,
    room_id: String,
    favourite: bool,
) -> Result<()> {
    rooms::set_favourite(&*state.core().await?, &parse_room_id(&room_id)?, favourite).await
}

#[tauri::command]
pub async fn set_room_low_priority(
    state: State<'_, AppState>,
    room_id: String,
    low_priority: bool,
) -> Result<()> {
    rooms::set_low_priority(&*state.core().await?, &parse_room_id(&room_id)?, low_priority).await
}

#[tauri::command]
pub async fn set_room_muted(
    state: State<'_, AppState>,
    room_id: String,
    muted: bool,
) -> Result<()> {
    rooms::set_muted(&*state.core().await?, &parse_room_id(&room_id)?, muted).await
}

#[tauri::command]
pub async fn set_room_marked_unread(
    state: State<'_, AppState>,
    room_id: String,
    unread: bool,
) -> Result<()> {
    rooms::set_marked_unread(&*state.core().await?, &parse_room_id(&room_id)?, unread).await
}

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn open_timeline(
    app: AppHandle,
    state: State<'_, AppState>,
    room_id: String,
    thread_root: Option<String>,
) -> Result<Vec<TimelineItemDto>> {
    let core = state.core().await?;
    timeline::open(&app, &core, &parse_room_id(&room_id)?, thread_root).await
}

#[tauri::command]
pub async fn close_timeline(
    state: State<'_, AppState>,
    room_id: String,
    thread_root: Option<String>,
) -> Result<()> {
    timeline::close(&*state.core().await?, &parse_room_id(&room_id)?, thread_root.as_deref()).await
}

#[tauri::command]
pub async fn send_message(
    state: State<'_, AppState>,
    room_id: String,
    options: SendOptions,
) -> Result<()> {
    timeline::send(&*state.core().await?, &parse_room_id(&room_id)?, options).await
}

#[tauri::command]
pub async fn paginate_back(
    state: State<'_, AppState>,
    room_id: String,
    thread_root: Option<String>,
) -> Result<bool> {
    timeline::paginate_back(&*state.core().await?, &parse_room_id(&room_id)?, thread_root.as_deref()).await
}

#[tauri::command]
pub async fn toggle_reaction(
    state: State<'_, AppState>,
    room_id: String,
    thread_root: Option<String>,
    event_id: String,
    key: String,
) -> Result<bool> {
    timeline::toggle_reaction(
        &*state.core().await?,
        &parse_room_id(&room_id)?,
        thread_root.as_deref(),
        &event_id,
        &key,
    )
    .await
}

#[tauri::command]
pub async fn edit_message(
    state: State<'_, AppState>,
    room_id: String,
    thread_root: Option<String>,
    event_id: String,
    body: String,
    markdown: bool,
) -> Result<()> {
    timeline::edit(
        &*state.core().await?,
        &parse_room_id(&room_id)?,
        thread_root.as_deref(),
        &event_id,
        &body,
        markdown,
    )
    .await
}

#[tauri::command]
pub async fn redact_event(
    state: State<'_, AppState>,
    room_id: String,
    thread_root: Option<String>,
    event_id: String,
    reason: Option<String>,
) -> Result<()> {
    timeline::redact(
        &*state.core().await?,
        &parse_room_id(&room_id)?,
        thread_root.as_deref(),
        &event_id,
        reason.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn mark_room_read(state: State<'_, AppState>, room_id: String) -> Result<()> {
    timeline::mark_as_read(&*state.core().await?, &parse_room_id(&room_id)?).await
}

#[tauri::command]
pub async fn send_read_receipt(
    state: State<'_, AppState>,
    room_id: String,
    event_id: String,
) -> Result<()> {
    timeline::send_read_receipt(&*state.core().await?, &parse_room_id(&room_id)?, &event_id).await
}

#[tauri::command]
pub async fn send_attachment(
    state: State<'_, AppState>,
    room_id: String,
    thread_root: Option<String>,
    path: String,
    caption: Option<String>,
) -> Result<()> {
    timeline::send_attachment(
        &*state.core().await?,
        &parse_room_id(&room_id)?,
        thread_root.as_deref(),
        &path,
        caption,
    )
    .await
}

#[tauri::command]
pub async fn get_pinned_events(
    state: State<'_, AppState>,
    room_id: String,
) -> Result<Vec<TimelineItemDto>> {
    timeline::pinned_events(&*state.core().await?, &parse_room_id(&room_id)?).await
}

#[tauri::command]
pub async fn get_event_body(
    state: State<'_, AppState>,
    room_id: String,
    event_id: String,
) -> Result<Option<String>> {
    timeline::event_body(&*state.core().await?, &parse_room_id(&room_id)?, &event_id).await
}

// ---------------------------------------------------------------------------
// media
// ---------------------------------------------------------------------------

/// The raw bytes of a piece of media, for `<video>` and `<audio>`.
///
/// Images load fine from the `uwum://` scheme, but WKWebView hands media
/// elements to AVFoundation, which never consults a custom scheme handler — the
/// request simply never arrives and the element reports "format not supported".
/// So media comes over IPC instead and the frontend wraps it in a `blob:` URL,
/// which AVFoundation will load.
#[tauri::command]
pub async fn get_media_bytes(
    state: State<'_, AppState>,
    mxc: String,
) -> Result<tauri::ipc::Response> {
    let media = media::fetch(&state.core().await?.client, &mxc, None, None).await?;
    Ok(tauri::ipc::Response::new(media.bytes))
}

#[tauri::command]
pub async fn save_media(
    state: State<'_, AppState>,
    mxc: String,
    destination: String,
) -> Result<()> {
    media::save_to(&state.core().await?.client, &mxc, &destination).await
}

// ---------------------------------------------------------------------------
// verification
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn request_verification(
    app: AppHandle,
    state: State<'_, AppState>,
    user_id: Option<String>,
) -> Result<()> {
    verification::request(&app, &*state.core().await?, user_id).await
}

#[tauri::command]
pub async fn accept_verification(
    state: State<'_, AppState>,
    user_id: String,
    flow_id: String,
) -> Result<()> {
    verification::accept(&*state.core().await?, &user_id, &flow_id).await
}

#[tauri::command]
pub async fn confirm_verification(
    state: State<'_, AppState>,
    user_id: String,
    flow_id: String,
) -> Result<()> {
    verification::confirm(&*state.core().await?, &user_id, &flow_id).await
}

#[tauri::command]
pub async fn mismatch_verification(
    state: State<'_, AppState>,
    user_id: String,
    flow_id: String,
) -> Result<()> {
    verification::mismatch(&*state.core().await?, &user_id, &flow_id).await
}

#[tauri::command]
pub async fn cancel_verification(
    state: State<'_, AppState>,
    user_id: String,
    flow_id: String,
) -> Result<()> {
    verification::cancel(&*state.core().await?, &user_id, &flow_id).await
}

#[tauri::command]
pub async fn get_own_devices(
    state: State<'_, AppState>,
) -> Result<Vec<verification::DeviceInfo>> {
    verification::own_devices(&*state.core().await?).await
}

#[tauri::command]
pub async fn verify_device(
    app: AppHandle,
    state: State<'_, AppState>,
    device_id: String,
) -> Result<()> {
    verification::verify_device(&app, &*state.core().await?, &device_id).await
}

#[tauri::command]
pub async fn get_recovery_status(
    state: State<'_, AppState>,
) -> Result<verification::RecoveryStatus> {
    verification::recovery_status(&*state.core().await?).await
}

#[tauri::command]
pub async fn enable_recovery(state: State<'_, AppState>) -> Result<String> {
    verification::enable_recovery(&*state.core().await?).await
}

#[tauri::command]
pub async fn recover_with_key(state: State<'_, AppState>, recovery_key: String) -> Result<()> {
    verification::recover(&*state.core().await?, &recovery_key).await
}

// ---------------------------------------------------------------------------
// calls
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn join_call(
    state: State<'_, AppState>,
    room_id: String,
    focus_override: Option<String>,
) -> Result<rtc::CallCredentials> {
    rtc::join(&*state.core().await?, &parse_room_id(&room_id)?, focus_override).await
}

#[tauri::command]
pub async fn leave_call(state: State<'_, AppState>, room_id: String) -> Result<()> {
    rtc::leave(&*state.core().await?, &parse_room_id(&room_id)?).await
}

#[tauri::command]
pub async fn refresh_call_membership(
    state: State<'_, AppState>,
    room_id: String,
) -> Result<()> {
    rtc::refresh(&*state.core().await?, &parse_room_id(&room_id)?).await
}

#[tauri::command]
pub async fn get_call_participants(
    state: State<'_, AppState>,
    room_id: String,
) -> Result<rtc::CallParticipants> {
    rtc::participants(&*state.core().await?, &parse_room_id(&room_id)?).await
}

#[tauri::command]
pub async fn get_active_calls(state: State<'_, AppState>) -> Result<Vec<String>> {
    Ok(rtc::active_calls(&*state.core().await?)
        .await?
        .into_iter()
        .map(|id| id.to_string())
        .collect())
}
