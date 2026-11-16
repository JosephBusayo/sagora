# The phone app

Android and iOS, built from this same branch with [Capacitor](https://capacitorjs.com). The app
is a native shell around the real site, not a copy of it.

That is deliberate, not a shortcut. Fifty pages are `force-dynamic` and twenty-nine files hold
server actions, so there is no bundle that could run without the server. It also means a farmer
on the app and a farmer on the web can never be shown a different price or a different quote.
One source, one truth.

## Running it

Android Studio and the SDK are the only requirements; Capacitor brings the rest.

```bash
npx cap sync android     # after any change to capacitor.config.ts or the plugins
npx cap open android     # opens Android Studio, where Run installs on a device
```

To build an APK without opening Android Studio, from `android/`:

```bash
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew assembleDebug
```

The result is `android/app/build/outputs/apk/debug/app-debug.apk`.

iOS needs a Mac. `npx cap add ios` creates the project; everything else here already applies.

## How the app differs from the website

Only where it genuinely must:

- The shell appends `SagoraApp` to its user agent (`capacitor.config.ts`). `src/proxy.ts` sees
  that at `/` and sends it to `/app` instead of the landing page — someone who installed the app
  has already decided. The redirect lives in the proxy because the landing page is static, and
  reading a header inside it would make the marketing page server-rendered for every visitor.
- `/app` is the entrance. Already signed in and you go straight to your own home, whichever role
  you are, because the session is a cookie the web view keeps between launches. Only someone
  signed out sees the choice between farmer and provider.
- An offline page, bundled in `mobile/www`, is shown when the phone cannot reach Sagora at all.

Everywhere else the app and the browser run exactly the same code.

## Notifications

Sagora tells people by email today. A farmer with a phone and no email address hears nothing,
which is the strongest reason this deserves to be an app rather than a bookmark — and the
clearest answer to Google Play's minimum-functionality policy and Apple's guideline 4.2.2.

Every message already goes through one funnel, `notify()` in `lib/outbox.ts`, so push hangs off
that rather than asking twenty-nine call sites to remember. A phone is registered after sign-in,
not at launch, so the permission request has a reason behind it.

**To switch it on**, someone needs to create a Firebase project — Karim's, in his own name, for
the same reason the Monime account must be:

1. Create a project at console.firebase.google.com and add an **Android app** with the package
   name **`sl.sagora.app`**.
2. Download `google-services.json` into `android/app/`. It is gitignored; each machine needs its
   own copy. Without it the app still builds and runs — it simply never asks for notifications.
3. In **Project settings → Service accounts**, generate a new private key. From that JSON set
   `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` in Vercel, writing
   the key's newlines as `\n`.
4. Run `npm run db:migrate` so `push_device` exists.

Unset, `pushConfigured()` is false and nothing is sent and nothing breaks, the same as SMS and
WhatsApp today.

## Building a release for Play

Play takes an *app bundle* (`.aab`), not an APK.

Signing is read from `android/keystore.properties`, which is gitignored and written per machine
- copy `android/keystore.properties.example` and fill it in. The keystore it points at belongs
outside the repository and must be backed up somewhere off the machine: anyone holding that file
and its passwords can publish an update as Sagora.

Without that file the release build is simply unsigned, and debug builds are untouched.

```bash
cd android
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew bundleRelease
```

The bundle lands at `android/app/build/outputs/bundle/release/app-release.aab`.

Accept **Play App Signing** when the listing is created. Google then holds the real signing key,
and the key above is only an upload key, which Google can reset if it is ever lost. Opting out
makes losing it final.

`versionCode` in `android/app/build.gradle` has to go up by one for every upload; Play rejects a
bundle whose code it has seen before.

## Before it can go on the stores

- **A privacy policy at a public URL.** Both stores require one, and there is none yet.
- **Play's Data safety form**, declaring what is collected. The app handles names, phone
  numbers, locations and payments, so this needs care rather than a guess.
- **A signing key** for the release build, kept somewhere it cannot be lost: losing it means the
  app can never be updated again under the same listing.
- **A Google Play account** ($25 once) and, for iOS, **Apple Developer** ($99/year).

## The risk worth keeping in mind

Capacitor's own documentation calls `server.url` "not intended for use in production". Real apps
do ship this way on both stores and the warning looks out of date, but what it warns about is
real: the native shell and the website drifting apart. Anything native added here must degrade
quietly when the shell is older than the site — `PushRegistrar` is written that way, and so is
`lib/push.ts`.

The bridge itself is not in doubt. Capacitor injects it with
`WebViewCompat.addDocumentStartJavaScript` against the origin from `server.url`, so it is present
on every page of the site and survives navigation within it. That needs `DOCUMENT_START_SCRIPT`,
which means a WebView from 2020 or later; on anything older the bridge is absent and the app
simply has no notifications, which is why none of this is allowed to throw.
