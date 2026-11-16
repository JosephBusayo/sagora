import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Sagora phone app (Android first, then iOS from the same project).
 *
 * The app is a native shell around the real site rather than a copy of it. That is not a
 * shortcut: every screen here is server-rendered and 29 files hold server actions, so there is
 * no bundle that could run without the server. Keeping one source also means a farmer on the
 * app and a farmer on the web never see different versions of a quote or a price.
 *
 * Capacitor's own documentation calls `server.url` "not intended for use in production". Real
 * apps ship this way on both stores, and the practical risk it warns about is native and web
 * drifting apart - which is why anything native added here must degrade quietly when the web
 * side is older or newer than the shell.
 */
const config: CapacitorConfig = {
  appId: "sl.sagora.app",
  appName: "Sagora",
  // Not where the app loads from - `server.url` wins - but `cap sync` wants somewhere real, and
  // it holds the page shown when the phone cannot reach Sagora at all.
  webDir: "mobile/www",
  server: {
    url: "https://www.sagora.sl",
    androidScheme: "https",
    // Shown instead of the browser's own error page when the site cannot be reached.
    errorPath: "offline.html",
  },
  // How the site knows it is being viewed inside the app: the landing page is skipped and the
  // sign-in screens drop the web-only chrome. Appended, so the rest of the agent string stays.
  android: { appendUserAgent: "SagoraApp/1" },
  ios: { appendUserAgent: "SagoraApp/1" },
  plugins: {
    SplashScreen: {
      // Held until the first screen has actually drawn, so the app never flashes a white page.
      launchAutoHide: false,
      launchShowDuration: 0,
      backgroundColor: "#024321",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
  },
};

export default config;
