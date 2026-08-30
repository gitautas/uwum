//! WebRTC in the WebView: switching it on where it ships off, and saying why
//! when it can't be switched on at all.
//!
//! macOS, Windows, iOS and Android all hand us a WebView with a working WebRTC
//! stack. Linux does not, so everything below is `target_os = "linux"` under a
//! thin cross-platform surface: `webrtc_diagnosis` returns `None` everywhere
//! else, which is how the frontend knows the WebView isn't the suspect.

use serde::Serialize;

/// What the native side can see about this WebView's WebRTC support.
///
/// The frontend asks for this only after `RTCPeerConnection` has turned out to
/// be missing, and turns it into a sentence that names the actual cause instead
/// of livekit's "your browser doesn't support this".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnosis {
    /// `enable-webrtc` as WebKitGTK reported it back *after* we set it.
    ///
    /// Worth reporting, worth nothing on its own: where WebRTC is compiled out
    /// the property is a stub that stores whatever it is given, so this reads
    /// back `true` on a WebKitGTK that has no WebRTC in it at all. Only a
    /// `false` here says anything — that the setter didn't even take.
    pub setting_enabled: bool,
    /// Same, for `enable-media-stream` — the one that puts `mediaDevices` on
    /// `navigator`.
    pub media_stream_enabled: bool,
    /// WebKitGTK's runtime version, e.g. `2.44.3`. `set_enable_webrtc` only
    /// exists from 2.38, and the GStreamer WebRTC backend only became usable
    /// around 2.40.
    pub webkit_version: String,
    /// Is `libgstwebrtc.so` (gst-plugins-bad) installed? WebKitGTK's backend is
    /// `webrtcbin`, and without it `RTCPeerConnection` stays hidden however the
    /// settings read back.
    pub gst_webrtc: bool,
    /// Is `libgstnice.so` (gstreamer1.0-nice) installed? That's ICE; without it
    /// a connection can be created but never gathers a candidate.
    pub gst_nice: bool,
    /// Running from an AppImage, which carries its own WebKitGTK — so the
    /// version above is that one, not whatever the distribution installed.
    pub appimage: bool,
}

/// What the native side knows about this WebView, or `None` off Linux.
#[tauri::command]
pub fn webrtc_diagnosis() -> Option<Diagnosis> {
    #[cfg(target_os = "linux")]
    {
        Some(linux::diagnosis())
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

/// Turn on WebRTC in the WebView, on the one platform that needs asking.
#[cfg(target_os = "linux")]
pub fn enable(app: &tauri::App) -> tauri::Result<()> {
    linux::enable(app)
}

#[cfg(target_os = "linux")]
mod linux {
    use std::sync::atomic::{AtomicBool, Ordering};

    use tauri::Manager;

    use super::Diagnosis;

    /// `enable-webrtc` and `enable-media-stream` as WebKitGTK read them back to
    /// us, recorded for [`diagnosis`]. They start `false` and stay `false` if
    /// the setup hook never ran, which is itself worth reporting.
    static WEBRTC_SETTING: AtomicBool = AtomicBool::new(false);
    static MEDIA_STREAM_SETTING: AtomicBool = AtomicBool::new(false);

    /// Turn on WebRTC in the WebView on Linux.
    ///
    /// WKWebView and WebView2 arrive with a working WebRTC stack; WebKitGTK
    /// does not. Two things are missing and both default to off:
    ///
    /// 1. `enable-webrtc` (and the `enable-media-stream` it implies) are
    ///    `FALSE` in a fresh `WebKitSettings`, and wry sets neither — it
    ///    configures WebGL and WebAudio and stops there. Without them
    ///    `RTCPeerConnection` and `navigator.mediaDevices` simply aren't on
    ///    `window`.
    /// 2. WebKitGTK asks the embedder for permission before handing over a
    ///    camera or microphone, via `permission-request`. wry never connects
    ///    that signal, so the request goes unanswered and WebKit denies it —
    ///    `getUserMedia` rejects even with the settings above.
    ///
    /// We grant unconditionally. The only thing this WebView ever loads is our
    /// own frontend over wry's custom scheme, so there is no third-party origin
    /// that could be asking; a prompt here would be a prompt we'd have to
    /// answer "yes" to on the user's behalf anyway. It leaves us level with
    /// macOS and Windows, where the OS itself owns the camera and microphone
    /// prompt.
    ///
    /// `DeviceInfoPermissionRequest` is granted for the same reason: without it
    /// `enumerateDevices()` still resolves, but every device comes back with an
    /// empty label, so the device picker in call settings shows a list of
    /// blanks.
    ///
    /// None of this helps on the WebKitGTK people actually have. `ENABLE_WEB_RTC`
    /// defaults to `ENABLE_EXPERIMENTAL_FEATURES`, which is `OFF`, and no major
    /// distribution overrides it — so WebRTC is compiled out and there is no
    /// setting that can bring it back. Everything here is for the WebKitGTK
    /// that *was* built with it; [`diagnosis`] is for all the rest.
    pub fn enable(app: &tauri::App) -> tauri::Result<()> {
        let Some(window) = app.get_webview_window("main") else {
            tracing::warn!("no main window at setup; WebRTC left disabled");
            return Ok(());
        };

        window.with_webview(|platform| {
            use webkit2gtk::{
                DeviceInfoPermissionRequest, PermissionRequestExt, SettingsExt,
                UserMediaPermissionRequest, WebViewExt, glib::prelude::Cast,
            };

            let webview = platform.inner();

            if let Some(settings) = WebViewExt::settings(&webview) {
                // `enable-webrtc` implies `enable-media-stream`, but say both:
                // the implication is documented behaviour we'd rather not lean
                // on, and media-stream is the one that puts `mediaDevices` on
                // `navigator`.
                settings.set_enable_media_stream(true);
                settings.set_enable_webrtc(true);
                // Read back rather than trust the setters — though the
                // read-back is not the tell it looks like: WebKitGTK stores
                // these properties whether or not there is any WebRTC behind
                // them. `false` would mean the setter didn't take; `true` means
                // only that it was stored.
                let webrtc = settings.enables_webrtc();
                let media_stream = settings.enables_media_stream();
                WEBRTC_SETTING.store(webrtc, Ordering::Relaxed);
                MEDIA_STREAM_SETTING.store(media_stream, Ordering::Relaxed);
                tracing::info!(
                    webrtc,
                    media_stream,
                    version = %webkit_version(),
                    "applied WebKitGTK media settings"
                );
            } else {
                tracing::warn!("WebView has no settings object; WebRTC left disabled");
            }

            webview.connect_permission_request(|_, request| {
                let ours = request.downcast_ref::<UserMediaPermissionRequest>().is_some()
                    || request.downcast_ref::<DeviceInfoPermissionRequest>().is_some();
                if ours {
                    request.allow();
                }
                // `true` means handled — returning it for requests we didn't
                // allow would silently swallow them.
                ours
            });
        })
    }

    pub fn diagnosis() -> Diagnosis {
        Diagnosis {
            setting_enabled: WEBRTC_SETTING.load(Ordering::Relaxed),
            media_stream_enabled: MEDIA_STREAM_SETTING.load(Ordering::Relaxed),
            webkit_version: webkit_version(),
            gst_webrtc: gst_plugin("libgstwebrtc.so"),
            gst_nice: gst_plugin("libgstnice.so"),
            appimage: std::env::var_os("APPIMAGE").is_some(),
        }
    }

    /// WebKitGTK's runtime version, which is what matters — the crate we build
    /// against only says which symbols exist.
    fn webkit_version() -> String {
        // SAFETY: three getters over static integers, safe to call at any time
        // from any thread.
        unsafe {
            format!(
                "{}.{}.{}",
                webkit2gtk_sys::webkit_get_major_version(),
                webkit2gtk_sys::webkit_get_minor_version(),
                webkit2gtk_sys::webkit_get_micro_version(),
            )
        }
    }

    /// Is a GStreamer plugin installed?
    ///
    /// Asking GStreamer itself would mean linking it; the plugins are plain
    /// shared objects in a small set of directories, so look for the file. The
    /// environment comes first because that is how an AppImage or a Nix profile
    /// points at its own copies.
    fn gst_plugin(file: &str) -> bool {
        let from_env = ["GST_PLUGIN_PATH", "GST_PLUGIN_SYSTEM_PATH"]
            .iter()
            .filter_map(std::env::var_os)
            .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>());

        let usual = [
            "/usr/lib/x86_64-linux-gnu/gstreamer-1.0",
            "/usr/lib/aarch64-linux-gnu/gstreamer-1.0",
            "/usr/lib64/gstreamer-1.0",
            "/usr/lib/gstreamer-1.0",
            "/usr/local/lib/gstreamer-1.0",
        ]
        .iter()
        .map(std::path::PathBuf::from);

        from_env.chain(usual).any(|dir| dir.join(file).exists())
    }
}
