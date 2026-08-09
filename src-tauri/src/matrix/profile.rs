//! Extended profiles (MSC4133).
//!
//! The homeserver stores arbitrary key/value pairs alongside `displayname` and
//! `avatar_url`, readable by anyone who can see the user. Continuwuity supports
//! this **without advertising `uk.tcpip.msc4133`** in `unstable_features`, so
//! don't infer support from the capability list — try the endpoint.
//!
//! Ruma doesn't model the endpoint yet, so these are plain HTTP calls carrying
//! the session's access token.
//!
//! The bio and status keys are Commet's, deliberately: it's the other client
//! that implements this, and matching its keys means a bio written in one shows
//! up in the other. Note the shapes differ — bio is an object, status is a bare
//! string. There's no observed key for a cover image anywhere, so that one is
//! ours and only uwum will read it.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    error::{Error, Result},
    matrix::MatrixCore,
};

const BIO_KEY: &str = "chat.commet.profile_bio";
const STATUS_KEY: &str = "chat.commet.profile_status";
const COVER_KEY: &str = "gg.uwu.cover_url";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDto {
    pub user_id: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    pub status: Option<String>,
    pub cover_url: Option<String>,
}

/// A partial update. `None` leaves a field alone; `Some("")` clears it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileUpdate {
    #[serde(default)]
    pub bio: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub cover_url: Option<String>,
}

fn http() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(Error::Http)
}

fn profile_url(core: &MatrixCore, user_id: &str, key: Option<&str>) -> Result<url::Url> {
    let path = match key {
        Some(key) => format!("/_matrix/client/v3/profile/{user_id}/{key}"),
        None => format!("/_matrix/client/v3/profile/{user_id}"),
    };
    core.client.homeserver().join(&path).map_err(Error::from)
}

/// Read a profile. `None` means our own.
///
/// Unknown or malformed fields are skipped rather than failing the read — a
/// profile is decoration, and one odd key shouldn't blank the rest.
pub async fn get_profile(core: &MatrixCore, user_id: Option<String>) -> Result<ProfileDto> {
    let user_id = match user_id {
        Some(id) => id,
        None => core.own_user_id()?.to_string(),
    };

    let response = http()?
        .get(profile_url(core, &user_id, None)?)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| Error::Other(format!("couldn't read that profile: {e}")))?;

    let body: Value = response.json().await?;

    let text = |key: &str| {
        body.get(key).and_then(|v| v.as_str()).map(str::to_owned).filter(|s| !s.is_empty())
    };

    Ok(ProfileDto {
        user_id,
        display_name: text("displayname"),
        avatar_url: text("avatar_url"),
        // Commet writes the bio as `{ "body": "…" }`; tolerate a bare string
        // too, since nothing stops another client from writing one.
        bio: body
            .get(BIO_KEY)
            .and_then(|v| v.get("body").and_then(|b| b.as_str()).or_else(|| v.as_str()))
            .map(str::to_owned)
            .filter(|s| !s.is_empty()),
        status: text(STATUS_KEY),
        cover_url: text(COVER_KEY),
    })
}

/// Write the fields that were supplied, leaving the rest untouched.
pub async fn set_profile(core: &MatrixCore, update: ProfileUpdate) -> Result<()> {
    if let Some(bio) = update.bio {
        // The object shape is Commet's; keep writing it even when clearing, so
        // the two clients agree on what an empty bio looks like.
        set_field(core, BIO_KEY, json!({ "body": bio }), bio.is_empty()).await?;
    }
    if let Some(status) = update.status {
        let empty = status.is_empty();
        set_field(core, STATUS_KEY, Value::String(status), empty).await?;
    }
    if let Some(cover) = update.cover_url {
        let empty = cover.is_empty();
        set_field(core, COVER_KEY, Value::String(cover), empty).await?;
    }
    Ok(())
}

async fn set_field(core: &MatrixCore, key: &str, value: Value, clear: bool) -> Result<()> {
    let user_id = core.own_user_id()?.to_string();
    let token = core
        .client
        .access_token()
        .ok_or_else(|| Error::Other("no access token on this session".into()))?;
    let url = profile_url(core, &user_id, Some(key))?;

    let client = http()?;
    let request = if clear {
        client.delete(url)
    } else {
        // MSC4133 mirrors the displayname endpoint: the body is the field keyed
        // by its own name.
        client.put(url).json(&json!({ key: value }))
    };

    let response = request.bearer_auth(token).send().await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        // A server without MSC4133 answers here rather than at the read, so
        // this is where the useful diagnosis lives.
        return Err(Error::Other(format!(
            "your homeserver rejected the profile update ({status}). it may not \
             support extended profiles. {body}"
        )));
    }

    Ok(())
}

/// Upload a local file to the media repository and return its `mxc://` URI.
///
/// Shared by anything that needs to put an image on the server — cover photos
/// now, custom emoji later.
pub async fn upload_media(core: &MatrixCore, path: &str) -> Result<String> {
    let bytes = tokio::fs::read(path).await?;
    let mime = mime_guess::from_path(path).first_or_octet_stream();

    let response = core
        .client
        .media()
        .upload(&mime, bytes, None)
        .await
        .map_err(|e| Error::Other(format!("upload failed: {e}")))?;

    Ok(response.content_uri.to_string())
}
