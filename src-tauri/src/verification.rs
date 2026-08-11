//! Interactive device verification (emoji SAS) and key recovery.
//!
//! This is the machinery behind the design's "new device wants in~" banner and
//! the verified badges in the member list. Requests can arrive two ways — via
//! to-device messages (verifying your own devices) or as an `m.room.message`
//! with `msgtype: m.key.verification.request` (verifying someone else in a DM) —
//! so both paths are handled.

use std::{collections::BTreeSet, sync::Arc, time::Duration};

use futures_util::StreamExt;
use matrix_sdk::{
    Client,
    encryption::verification::{
        SasState, SasVerification, Verification, VerificationRequest, VerificationRequestState,
    },
    ruma::{
        UserId,
        events::key::verification::{
            VerificationMethod, request::ToDeviceKeyVerificationRequestEvent,
        },
        events::room::message::{MessageType, OriginalSyncRoomMessageEvent},
    },
};
use matrix_sdk_ui::timeline::EncryptedMessage;
use serde::Serialize;
use tauri::AppHandle;

use crate::{
    error::{Error, Result},
    events::{EV_VERIFICATION_REQUEST, EV_VERIFICATION_UPDATE, emit},
    matrix::MatrixCore,
};

/// The verification methods this app can actually carry out. Emoji SAS is the
/// only one the UI implements; advertising anything else invites the other
/// client to pick a flow that dead-ends here.
const SAS_ONLY: &[VerificationMethod] = &[VerificationMethod::SasV1];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationRequestDto {
    pub flow_id: String,
    pub other_user_id: String,
    pub other_device_id: Option<String>,
    pub is_self_verification: bool,
    pub we_started: bool,
    /// `requested` | `ready` | `transitioned` | `done` | `cancelled`
    pub state: String,
    /// Why the flow ended, when it ended badly and before SAS ever started —
    /// otherwise there is nothing to show the user but "it stopped".
    pub cancel_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SasStateDto {
    pub flow_id: String,
    pub other_user_id: String,
    /// `created` | `started` | `accepted` | `keysExchanged` | `confirmed` | `done` | `cancelled`
    pub state: String,
    /// The seven SAS emoji, once both sides have exchanged keys.
    pub emoji: Option<Vec<SasEmoji>>,
    pub decimals: Option<[u16; 3]>,
    pub cancel_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SasEmoji {
    pub symbol: String,
    pub description: String,
}

fn request_state_name(state: &VerificationRequestState) -> &'static str {
    match state {
        VerificationRequestState::Created { .. } => "created",
        VerificationRequestState::Requested { .. } => "requested",
        VerificationRequestState::Ready { .. } => "ready",
        VerificationRequestState::Transitioned { .. } => "transitioned",
        VerificationRequestState::Done => "done",
        VerificationRequestState::Cancelled(_) => "cancelled",
    }
}

fn to_dto(request: &VerificationRequest) -> VerificationRequestDto {
    VerificationRequestDto {
        flow_id: request.flow_id().to_owned(),
        other_user_id: request.other_user_id().to_string(),
        other_device_id: None,
        is_self_verification: request.is_self_verification(),
        we_started: request.we_started(),
        state: request_state_name(&request.state()).to_owned(),
        cancel_reason: request_cancel_reason(&request.state()),
    }
}

fn request_cancel_reason(state: &VerificationRequestState) -> Option<String> {
    match state {
        VerificationRequestState::Cancelled(info) => Some(info.reason().to_owned()),
        _ => None,
    }
}

/// Register handlers for incoming verification requests and keep them running
/// for the life of the session.
pub async fn watch_requests(app: AppHandle, core: Arc<MatrixCore>) {
    let client = core.client.clone();

    // Path 1: another of our own devices asks to verify, over to-device.
    let app_to_device = app.clone();
    let core_to_device = core.clone();
    client.add_event_handler(
        move |event: ToDeviceKeyVerificationRequestEvent, client: Client| {
            let app = app_to_device.clone();
            let core = core_to_device.clone();
            async move {
                let Some(request) = client
                    .encryption()
                    .get_verification_request(&event.sender, &event.content.transaction_id)
                    .await
                else {
                    return;
                };
                announce(app, core, request).await;
            }
        },
    );

    // Path 2: someone verifies us from inside a room (the DM flow).
    let app_in_room = app.clone();
    let core_in_room = core.clone();
    client.add_event_handler(move |event: OriginalSyncRoomMessageEvent, client: Client| {
        let app = app_in_room.clone();
        let core = core_in_room.clone();
        async move {
            if !matches!(event.content.msgtype, MessageType::VerificationRequest(_)) {
                return;
            }
            let Some(request) = client
                .encryption()
                .get_verification_request(&event.sender, &event.event_id)
                .await
            else {
                return;
            };
            announce(app, core, request).await;
        }
    });

    // Keep this task alive; the handlers above live as long as the client does.
    std::future::pending::<()>().await;
}

/// Tell the UI about a request, then follow it until it resolves.
async fn announce(app: AppHandle, core: Arc<MatrixCore>, request: VerificationRequest) {
    emit(&app, EV_VERIFICATION_REQUEST, to_dto(&request));

    tokio::spawn(async move {
        let is_self = request.is_self_verification();
        let mut changes = request.changes();
        while let Some(state) = changes.next().await {
            emit(
                &app,
                EV_VERIFICATION_UPDATE,
                VerificationRequestDto {
                    flow_id: request.flow_id().to_owned(),
                    other_user_id: request.other_user_id().to_string(),
                    other_device_id: None,
                    is_self_verification: request.is_self_verification(),
                    we_started: request.we_started(),
                    state: request_state_name(&state).to_owned(),
                    cancel_reason: request_cancel_reason(&state),
                },
            );

            // Once the other side picks SAS, start reporting emoji instead.
            if let VerificationRequestState::Transitioned { verification, .. } = &state
                && let Verification::SasV1(sas) = verification
            {
                watch_sas(app.clone(), sas.clone(), request.flow_id().to_owned());
            }

            if matches!(state, VerificationRequestState::Done) {
                // Verifying our own device is what unlocks the history; go and
                // fetch it rather than making the user restart the app.
                if is_self {
                    tokio::spawn(unlock_history(core.clone()));
                }
                break;
            }

            if matches!(state, VerificationRequestState::Cancelled(_)) {
                break;
            }
        }
    });
}

/// How long to wait for the backup decryption key to arrive after a
/// verification, before giving up and retrying with whatever keys we do have.
const BACKUP_WAIT: Duration = Duration::from_secs(30);

/// Pull in the message history a freshly verified device has just earned.
///
/// Verification succeeding is not the end of the story. The other device then
/// sends us our secrets — including the key to the server-side backup — as an
/// `m.secret.send`, and only once *that* lands can the backup be read. Nothing
/// drives the rest on its own, which is why the history used to stay unreadable
/// until the app was restarted and every timeline was rebuilt from scratch.
///
/// So: wait for the backup to come up, download the keys for the rooms the user
/// actually has open, and ask those timelines to decrypt again.
async fn unlock_history(core: Arc<MatrixCore>) {
    let backups = core.client.encryption().backups();

    let deadline = tokio::time::Instant::now() + BACKUP_WAIT;
    while !backups.are_enabled().await && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    // Snapshot rather than holding the lock across the network calls below —
    // opening a room takes the same lock.
    let open: Vec<_> =
        core.timelines.lock().await.values().map(|open| open.timeline.clone()).collect();

    for timeline in open {
        let room_id = timeline.room().room_id().to_owned();

        // Best-effort: a room with no keys in the backup, or no backup at all,
        // is not an error — the retry below still runs, because the keys may
        // have arrived over to-device gossip instead.
        if let Err(e) = backups.download_room_keys_for_room(&room_id).await {
            tracing::debug!("no backed-up keys for {room_id}: {e}");
        }

        let session_ids = undecryptable_sessions(&timeline).await;
        if session_ids.is_empty() {
            continue;
        }
        tracing::info!("retrying {} undecryptable sessions in {room_id}", session_ids.len());
        timeline.retry_decryption(session_ids).await;
    }
}

/// The Megolm sessions a timeline is currently showing as "can't decrypt".
async fn undecryptable_sessions(timeline: &matrix_sdk_ui::Timeline) -> BTreeSet<String> {
    timeline
        .items()
        .await
        .iter()
        .filter_map(|item| item.as_event())
        .filter_map(|event| match event.content().as_unable_to_decrypt() {
            Some(EncryptedMessage::MegolmV1AesSha2 { session_id, .. }) => Some(session_id.clone()),
            // Olm-encrypted and unknown-algorithm events have no session to
            // retry — no key will ever make them readable.
            _ => None,
        })
        .collect()
}

fn sas_dto(sas: &SasVerification, flow_id: &str, state: &SasState) -> SasStateDto {
    let name = match state {
        SasState::Created { .. } => "created",
        SasState::Started { .. } => "started",
        SasState::Accepted { .. } => "accepted",
        SasState::KeysExchanged { .. } => "keysExchanged",
        SasState::Confirmed => "confirmed",
        SasState::Done { .. } => "done",
        SasState::Cancelled(_) => "cancelled",
    };

    let emoji = sas.emoji().map(|list| {
        list.iter()
            .map(|e| SasEmoji {
                symbol: e.symbol.to_owned(),
                description: e.description.to_owned(),
            })
            .collect()
    });

    SasStateDto {
        flow_id: flow_id.to_owned(),
        other_user_id: sas.other_user_id().to_string(),
        state: name.to_owned(),
        emoji,
        decimals: sas.decimals().map(|(a, b, c)| [a, b, c]),
        cancel_reason: sas.cancel_info().map(|info| info.reason().to_owned()),
    }
}

fn watch_sas(app: AppHandle, sas: SasVerification, flow_id: String) {
    tokio::spawn(async move {
        let mut changes = sas.changes();
        while let Some(state) = changes.next().await {
            // `Started` means *they* sent the `m.key.verification.start` and we
            // are the side that has to answer with an `m.key.verification.accept`
            // before either device will send a key. Nothing in the SDK does this
            // for us, so a SAS left in this state simply stalls: no emoji ever
            // arrive, we go silent, and the other client eventually gives up
            // with "verification failed".
            //
            // We reach this state more often than it looks. Even when we started
            // SAS ourselves, the other side usually starts one too, and the spec
            // tie-break discards whichever start came from the lexicographically
            // larger device ID — so on roughly half of all verifications *our*
            // start is the one thrown away and theirs is the one we must accept.
            // That is why this failed for some people and not others.
            if matches!(state, SasState::Started { .. })
                && let Err(e) = sas.accept().await
            {
                tracing::error!("couldn't accept SAS verification {flow_id}: {e}");
            }

            emit(&app, EV_VERIFICATION_UPDATE, sas_dto(&sas, &flow_id, &state));
            if matches!(state, SasState::Done { .. } | SasState::Cancelled(_)) {
                break;
            }
        }
    });
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

async fn find_request(
    core: &MatrixCore,
    user_id: &str,
    flow_id: &str,
) -> Result<VerificationRequest> {
    let user_id = UserId::parse(user_id)?;
    core.client
        .encryption()
        .get_verification_request(&user_id, flow_id)
        .await
        .ok_or_else(|| Error::Other("that verification is no longer active".into()))
}

async fn find_sas(core: &MatrixCore, user_id: &str, flow_id: &str) -> Result<SasVerification> {
    let user_id = UserId::parse(user_id)?;
    match core.client.encryption().get_verification(&user_id, flow_id).await {
        Some(Verification::SasV1(sas)) => Ok(sas),
        _ => Err(Error::Other("that verification is no longer active".into())),
    }
}

/// Ask another device (or user) to verify us.
pub async fn request(
    app: &AppHandle,
    core: &Arc<MatrixCore>,
    user_id: Option<String>,
) -> Result<()> {
    let encryption = core.client.encryption();

    let request = match user_id {
        // Verifying another person happens in the DM you share with them.
        Some(user_id) => {
            let user_id = UserId::parse(&user_id)?;
            let identity = encryption
                .get_user_identity(&user_id)
                .await
                .map_err(|e| Error::Other(e.to_string()))?
                .ok_or_else(|| Error::Other("we don't have that user's keys yet".into()))?;
            identity
                .request_verification_with_methods(SAS_ONLY.to_vec())
                .await
                .map_err(|e| Error::Other(format!("couldn't start verification: {e}")))?
        }
        // Verifying ourselves goes to our other devices over to-device.
        None => {
            let device = encryption
                .get_own_device()
                .await
                .map_err(|e| Error::Other(e.to_string()))?
                .ok_or_else(|| Error::Other("no local device found".into()))?;
            device
                .request_verification_with_methods(SAS_ONLY.to_vec())
                .await
                .map_err(|e| Error::Other(format!("couldn't start verification: {e}")))?
        }
    };

    announce(app.clone(), core.clone(), request).await;
    Ok(())
}

pub async fn accept(core: &MatrixCore, user_id: &str, flow_id: &str) -> Result<()> {
    let request = find_request(core, user_id, flow_id).await?;
    // Advertise emoji only. `accept()` would also claim `m.qr_code.show.v1` and
    // `m.reciprocate.v1` — the SDK's defaults, because the `qrcode` feature is
    // on for the crypto crate — and the other client believes us: Element then
    // leads with "scan the code on your other device" for a code this app never
    // draws, and the user is stuck in a flow that cannot finish.
    request.accept_with_methods(SAS_ONLY.to_vec()).await?;
    // Emoji SAS is the only method the UI implements, so drive it directly
    // rather than waiting for the other side to choose. If they start one too,
    // the spec's tie-break picks a winner and `watch_sas` accepts theirs.
    request.start_sas().await?;
    Ok(())
}

/// The user says the emoji match on both screens.
pub async fn confirm(core: &MatrixCore, user_id: &str, flow_id: &str) -> Result<()> {
    find_sas(core, user_id, flow_id).await?.confirm().await?;
    Ok(())
}

/// The user says the emoji do *not* match — this is a real security signal, so
/// it goes to the server as a mismatch rather than a plain cancel.
pub async fn mismatch(core: &MatrixCore, user_id: &str, flow_id: &str) -> Result<()> {
    find_sas(core, user_id, flow_id).await?.mismatch().await?;
    Ok(())
}

pub async fn cancel(core: &MatrixCore, user_id: &str, flow_id: &str) -> Result<()> {
    if let Ok(sas) = find_sas(core, user_id, flow_id).await {
        sas.cancel().await?;
        return Ok(());
    }
    find_request(core, user_id, flow_id).await?.cancel().await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// this account's devices
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub device_id: String,
    pub display_name: Option<String>,
    pub is_verified: bool,
    /// True for the device this app is running as — it can't verify itself.
    pub is_current: bool,
    pub first_seen: u64,
}

/// Every device signed in to this account, current one first.
pub async fn own_devices(core: &MatrixCore) -> Result<Vec<DeviceInfo>> {
    let user_id = core.own_user_id()?;
    let current = core.client.device_id().map(|d| d.to_owned());

    let devices = core
        .client
        .encryption()
        .get_user_devices(&user_id)
        .await
        .map_err(|e| Error::Other(e.to_string()))?;

    let mut out: Vec<DeviceInfo> = devices
        .devices()
        // A deleted device lingers in the store briefly after a sign-out
        // elsewhere; showing it would just invite a pointless verification.
        .filter(|device| !device.is_deleted())
        .map(|device| DeviceInfo {
            device_id: device.device_id().to_string(),
            display_name: device.display_name().map(str::to_owned),
            // NOT `is_verified()`. That is true when a device is *either*
            // cross-signed or locally trusted, and the SDK locally trusts the
            // device it is running on — so our own session would always claim
            // to be verified, including before it ever has been. Only a
            // cross-signature is real evidence.
            is_verified: device.is_verified_with_cross_signing(),
            is_current: current.as_deref() == Some(device.device_id()),
            first_seen: device.first_time_seen_ts().0.into(),
        })
        .collect();

    // This device first, then unverified ones (they're what needs attention),
    // then the rest newest-first.
    out.sort_by(|a, b| {
        b.is_current
            .cmp(&a.is_current)
            .then(a.is_verified.cmp(&b.is_verified))
            .then(b.first_seen.cmp(&a.first_seen))
    });
    Ok(out)
}

/// Start verifying one of our own devices.
pub async fn verify_device(app: &AppHandle, core: &Arc<MatrixCore>, device_id: &str) -> Result<()> {
    let user_id = core.own_user_id()?;
    let device_id = matrix_sdk::ruma::OwnedDeviceId::from(device_id);

    let device = core
        .client
        .encryption()
        .get_device(&user_id, &device_id)
        .await
        .map_err(|e| Error::Other(e.to_string()))?
        .ok_or_else(|| Error::Other("that device is no longer signed in".into()))?;

    let request = device
        .request_verification_with_methods(SAS_ONLY.to_vec())
        .await
        .map_err(|e| Error::Other(format!("couldn't start verification: {e}")))?;

    announce(app.clone(), core.clone(), request).await;
    Ok(())
}

// ---------------------------------------------------------------------------
// recovery / key backup
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryStatus {
    /// `enabled` | `disabled` | `incomplete` | `unknown`
    pub state: String,
    pub backup_exists: bool,
    pub cross_signing_ready: bool,
}

pub async fn recovery_status(core: &MatrixCore) -> Result<RecoveryStatus> {
    use matrix_sdk::encryption::recovery::RecoveryState;

    let encryption = core.client.encryption();
    let state = match encryption.recovery().state() {
        RecoveryState::Enabled => "enabled",
        RecoveryState::Disabled => "disabled",
        RecoveryState::Incomplete => "incomplete",
        RecoveryState::Unknown => "unknown",
    };

    let cross_signing_ready = encryption
        .cross_signing_status()
        .await
        .is_some_and(|status| status.is_complete());

    Ok(RecoveryStatus {
        state: state.to_owned(),
        backup_exists: encryption.backups().exists_on_server().await.unwrap_or(false),
        cross_signing_ready,
    })
}

/// Turn on key backup and return the recovery key.
///
/// The key is shown once and never stored by us — losing it means losing access
/// to backed-up message history, which is exactly the trade-off recovery keys
/// exist to make explicit.
pub async fn enable_recovery(core: &MatrixCore) -> Result<String> {
    let key = core
        .client
        .encryption()
        .recovery()
        .enable()
        .wait_for_backups_to_upload()
        .await
        .map_err(|e| Error::Other(format!("couldn't enable recovery: {e}")))?;
    Ok(key)
}

/// Restore access to backed-up keys using a recovery key the user kept.
pub async fn recover(core: &Arc<MatrixCore>, recovery_key: &str) -> Result<()> {
    core.client
        .encryption()
        .recovery()
        .recover(recovery_key)
        .await
        .map_err(|e| Error::Other(format!("that recovery key didn't work: {e}")))?;

    // Same story as a successful verification: the keys are reachable now, but
    // the timelines already on screen won't notice by themselves.
    tokio::spawn(unlock_history(core.clone()));
    Ok(())
}
