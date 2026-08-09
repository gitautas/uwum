//! A single error type for everything crossing the Tauri IPC boundary.
//!
//! The frontend only ever sees `{ kind, message }`, so it can branch on `kind`
//! without parsing prose.

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("not signed in")]
    NotSignedIn,

    #[error("{0}")]
    Auth(String),

    #[error("unknown room {0}")]
    UnknownRoom(String),

    #[error("no open timeline for room {0}")]
    NoTimeline(String),

    #[error("{0}")]
    Matrix(#[from] matrix_sdk::Error),

    #[error("{0}")]
    MatrixHttp(#[from] matrix_sdk::HttpError),

    #[error("{0}")]
    Id(#[from] matrix_sdk::IdParseError),

    #[error("{0}")]
    ClientBuild(#[from] matrix_sdk::ClientBuildError),

    #[error("{0}")]
    Timeline(#[from] matrix_sdk_ui::timeline::Error),

    #[error("{0}")]
    RoomList(#[from] matrix_sdk_ui::room_list_service::Error),

    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Http(#[from] reqwest::Error),

    #[error("{0}")]
    Other(String),
}

impl Error {
    /// A stable, machine-readable discriminant for the frontend.
    fn kind(&self) -> &'static str {
        match self {
            Self::NotSignedIn => "not_signed_in",
            Self::Auth(_) => "auth",
            Self::UnknownRoom(_) => "unknown_room",
            Self::NoTimeline(_) => "no_timeline",
            Self::Matrix(_) | Self::MatrixHttp(_) => "matrix",
            Self::Id(_) => "bad_id",
            Self::ClientBuild(_) => "client_build",
            Self::Timeline(_) => "timeline",
            Self::RoomList(_) => "room_list",
            Self::Io(_) => "io",
            Self::Json(_) => "json",
            Self::Http(_) => "http",
            Self::Other(_) => "other",
        }
    }
}

impl From<anyhow::Error> for Error {
    fn from(e: anyhow::Error) -> Self {
        Self::Other(e.to_string())
    }
}

impl From<url::ParseError> for Error {
    fn from(e: url::ParseError) -> Self {
        Self::Other(e.to_string())
    }
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("Error", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

pub type Result<T, E = Error> = std::result::Result<T, E>;
