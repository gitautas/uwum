import React from "react";
import ReactDOM from "react-dom/client";

// Self-hosted fonts and icons, bundled so the app works offline and satisfies
// the CSP, which forbids remote stylesheets.
// Baloo 2 — display · Unbounded — rave · Nunito — body · JetBrains Mono — code
import "@fontsource/baloo-2/500.css";
import "@fontsource/baloo-2/600.css";
import "@fontsource/baloo-2/700.css";
import "@fontsource/baloo-2/800.css";
import "@fontsource/unbounded/500.css";
import "@fontsource/unbounded/700.css";
import "@fontsource/unbounded/800.css";
import "@fontsource/unbounded/900.css";
import "@fontsource-variable/nunito";
import "@fontsource-variable/jetbrains-mono";
import "@phosphor-icons/web/fill";

import App from "./App";
import { ensureWebrtc } from "./lib/call";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/index.css";

// Before anything asks for a microphone: on Linux the WebView can come up
// without a WebRTC stack, and only a reload can give it one. Fire and forget —
// it is a no-op on every other platform, and a reload here costs nothing
// because nobody has signed in yet.
void ensureWebrtc();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
