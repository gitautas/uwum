//! The live Matrix session: one `Client`, one `SyncService`, and the set of
//! timelines the UI currently has open.
//!
//! Everything the frontend can reach goes through here, so the locking story is
//! deliberately dull: a single `RwLock` around the whole session in `AppState`,
//! and a `Mutex<HashMap>` for open timelines. Chat traffic is nowhere near
//! contended enough to justify anything cleverer, and cleverer is where
//! deadlocks live.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool},
};

use matrix_sdk::{Client, ruma::OwnedRoomId};
use matrix_sdk_ui::{RoomListService, Timeline, sync_service::SyncService};
use tokio::{
    sync::{Mutex, RwLock},
    task::JoinHandle,
};

use crate::{dto::SessionInfo, error::Result, matrix::session::SessionPointer};

/// A timeline the UI has open, plus the task streaming its diffs.
pub struct OpenTimeline {
    pub timeline: Arc<Timeline>,
    pub task: JoinHandle<()>,
}

impl Drop for OpenTimeline {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// The room list the frontend is believed to hold, and the number of diff
/// batches folded into it. `seq` only ever increases; batch N carries seq N.
#[derive(Default)]
pub struct RoomMirror {
    pub seq: u64,
    pub rooms: Vec<crate::dto::RoomSummary>,
}

pub struct MatrixCore {
    pub client: Client,
    pub sync_service: Arc<SyncService>,
    pub room_list: Arc<RoomListService>,
    pub pointer: SessionPointer,
    #[allow(dead_code)] // kept alongside the session for store maintenance
    pub data_dir: PathBuf,
    /// The room list as last pushed to the frontend, and how many diff batches
    /// have been folded into it.
    ///
    /// Sync starts as soon as a session is restored, which is before the UI has
    /// had a chance to subscribe — so the first `Reset` would otherwise be sent
    /// to nobody. Keeping a mirror lets a newly-mounted UI ask for the current
    /// list instead of waiting for the next change.
    ///
    /// The counter is what makes that snapshot safe to combine with the diff
    /// stream. Updating the mirror and emitting the event cannot be one atomic
    /// step as far as the frontend is concerned — the command response and the
    /// event travel separately and can arrive in either order — so a snapshot
    /// says which batches it already contains, and the frontend drops the ones
    /// it's seen.
    pub rooms: Mutex<RoomMirror>,
    /// Keyed by room ID, or `"<room_id>|<thread_root>"` for thread timelines.
    pub timelines: Mutex<HashMap<String, OpenTimeline>>,
    /// Background tasks owned by this session, aborted on sign-out.
    pub tasks: Mutex<Vec<JoinHandle<()>>>,
    pub shutting_down: AtomicBool,
}

impl MatrixCore {
    pub async fn session_info(&self) -> Result<SessionInfo> {
        let account = self.client.account();
        // A missing profile is normal (new account, or a server that 404s the
        // endpoint) and must not block sign-in, so failures degrade to `None`.
        let display_name = account.get_display_name().await.ok().flatten();
        let avatar_url = account.get_avatar_url().await.ok().flatten();

        Ok(SessionInfo {
            user_id: self.pointer.user_id.clone(),
            device_id: self.pointer.device_id.clone(),
            homeserver: self.pointer.homeserver.clone(),
            display_name,
            avatar_url: avatar_url.map(|u| u.to_string()),
            insecure_storage: self.pointer.insecure_fallback,
        })
    }

    /// Abort every background task and stop syncing. Called on sign-out and on
    /// window close so the SQLite store is released cleanly.
    pub async fn shutdown(&self) {
        self.shutting_down.store(true, std::sync::atomic::Ordering::SeqCst);
        self.sync_service.stop().await;

        for (_, open) in self.timelines.lock().await.drain() {
            open.task.abort();
        }
        for task in self.tasks.lock().await.drain(..) {
            task.abort();
        }
    }

    pub fn own_user_id(&self) -> Result<matrix_sdk::ruma::OwnedUserId> {
        self.client
            .user_id()
            .map(|u| u.to_owned())
            .ok_or_else(|| crate::error::Error::NotSignedIn)
    }

    pub fn room(&self, room_id: &OwnedRoomId) -> Result<matrix_sdk::Room> {
        self.client
            .get_room(room_id)
            .ok_or_else(|| crate::error::Error::UnknownRoom(room_id.to_string()))
    }
}

/// The one piece of state Tauri manages. `None` until someone signs in.
#[derive(Default)]
pub struct AppState {
    pub core: RwLock<Option<Arc<MatrixCore>>>,
}

impl AppState {
    pub async fn core(&self) -> Result<Arc<MatrixCore>> {
        self.core.read().await.clone().ok_or(crate::error::Error::NotSignedIn)
    }

    pub async fn set(&self, core: Arc<MatrixCore>) {
        let previous = self.core.write().await.replace(core);
        if let Some(previous) = previous {
            previous.shutdown().await;
        }
    }

    pub async fn take(&self) -> Option<Arc<MatrixCore>> {
        self.core.write().await.take()
    }
}
