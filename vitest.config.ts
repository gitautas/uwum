import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // The rich-text renderer needs a real DOMParser; happy-dom is the cheapest
    // way to get one outside the app.
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
    // Node 25+ ships its own `localStorage` global, which is `undefined` unless
    // started with `--localstorage-file`, and it shadows happy-dom's. Switch it
    // off so the tests see the emulated storage, as the app's webview would.
    execArgv: ["--no-experimental-webstorage"],
    environmentOptions: {
      // A real browser treats a `DOMParser` document as inert and loads none of
      // its subresources; happy-dom tries anyway and fills the output with DNS
      // errors. Turn that off so the tests assert on our behaviour rather than
      // on the emulator's. In the app itself the CSP is the backstop — it
      // permits no external hosts and no frames at all.
      happyDOM: {
        settings: {
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
          disableIframePageLoading: true,
        },
      },
    },
  },
});
