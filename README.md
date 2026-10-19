# Flutter Locho Notes

For the **Caddy → Locho → Flutter “Hello” demo**, see
[`demo/hello/README.md`](demo/hello/README.md). Start it with `npm run demo:hello`.

One Flutter notes UI for **Android, iOS, and web**, with the shared notes code
included as an in-repository Dart package:

```text
locho-flutter/
├── lib/                         # app entrypoints and browser/native adapters
├── packages/locho_notes/         # shared UI, session controller and SSE
├── demo/hello/                  # Caddy and Locho demo configurations
└── tool/                        # browser asset and optional live-demo tooling
```

The app builds from this repository alone. `locho_notes` is not published on
pub.dev; its source and provenance are included in
[`packages/locho_notes/README.md`](packages/locho_notes/README.md). The actual
Locho SDKs are installed from pub.dev and npm, not copied from sibling checkouts.

Both transport SDKs use published, locked **0.1.0-beta.2** releases:

| Target | Transport | Session storage (opt-in) |
| --- | --- | --- |
| Android/iOS | pub.dev `locho_flutter`, native Rust tunnel + Dart HTTP | Platform secure storage |
| Web | npm `locho_web`, JavaScript wrapper + Rust WASM via Dart JS interop | IndexedDB |

Features match the reference notes application: private ticket pairing, API
validation, login/logout, create/edit/delete, streamed live updates, reconnect,
foreground lifecycle handling, validated session restoration, and forgetting a
saved host. Tickets and API login tokens remain independent.

## Setup and run in Chrome

From this directory:

```sh
flutter pub get
npm ci
npm run prepare:web
flutter run -d chrome
```

Node 20+ suffices for this application's browser tooling. The reference API needs
**Node 24.18+ (24.x)** and npm 11.16. Run `prepare:web` after a fresh checkout or
changing the npm SDK version. It bundles the published ESM wrapper and copies its
matching WASM into ignored `web/locho/`; no Rust toolchain is needed for web.

### Start the reference API

The notes server is a separate runtime service, not a Flutter build dependency.
To run the reference server locally, clone its repository alongside this one:

```sh
git clone https://github.com/trchopan/locho_sdk_examples.git ../locho_sdk_examples
```

Then, in `../locho_sdk_examples`, using the required Node version:

```sh
npm ci
npm run seed
npm run dev:api
```

With a compatible Locho CLI installed, in another terminal in that repository:

```sh
locho host --config deploy/locho.toml
```

In a third terminal:

```sh
locho share sample-api --config deploy/locho.toml --ticket
```

Paste the resulting `locho1:...` ticket into the Flutter app and pair. Then log in
using a development account from the reference repository's README. The browser
needs reachable HTTPS/WSS discovery/relay services; it does not connect to a
localhost companion or fetch the host API directly.

## Mobile

```sh
flutter run -d <android-or-ios-device-id>
flutter build apk --debug --target-platform android-arm64,android-x64
flutter build ios --simulator
```

The published Flutter plugin builds Rust sources during native compilation:

- Rust **1.96+**, Cargo, and the relevant mobile targets.
- Android: accepted SDK licenses, JDK 21 recommended, SDK API 23+, NDK
  **28.2.13676358**. This app matches the SDK's ARM64/x86_64 ABI set.
- iOS: Xcode with a simulator/device runtime and CocoaPods. The SDK supports iOS
  13+, while this app retains Flutter's generated deployment target.

On this Mac, Rust/rustup and CocoaPods are now installed through Homebrew, the
Android/iOS Rust targets are installed, and Xcode has an iOS 26.3.1 simulator
runtime. Rust is available in new zsh terminals. In an existing terminal use:

```sh
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
```

Native output locations:

- Android debug APK: `build/app/outputs/flutter-apk/app-debug.apk`
- iOS simulator app: `build/ios/iphonesimulator/Runner.app`

`flutter doctor` may still request acceptance of additional Android SDK licenses;
these do not block the verified builds. Review them with
`flutter doctor --android-licenses`.

Swift Package Manager is disabled **for this app** in `pubspec.yaml` because the
Locho plugin currently uses CocoaPods; no global Flutter setting is changed.

Android permits cleartext HTTP only for the SDK's `127.0.0.1` loopback endpoint;
the remote tunnel is encrypted. macOS, Linux, and Windows are not supported by
the current native Locho SDK, even though Flutter generated their project folders.

## Production web builds

```sh
npm run prepare:web
flutter build web --no-web-resources-cdn
```

To compile **Flutter itself** to WASM as well:

```sh
flutter build web --wasm --no-web-resources-cdn
```

Locho's Rust WASM is used in either Flutter build mode. Deploy all of `build/web`
over HTTPS (localhost HTTP is fine for development), serving `.wasm` as
`application/wasm`. Subpath deployments can use Flutter's `--base-href /path/`;
the bridge resolves its WASM relative to its own module URL.

Browser persistence is not mobile secure storage: the optional IndexedDB record
is accessible to scripts running on the same origin. Remember defaults to off;
passwords are never stored. Both platform adapters use the reference app's
foreground-only lifecycle and request cancellation, with no automatic write replay.

## How the shared app works

```text
lib/main.dart
  └─ local locho_notes: NotesApp + NotesSession
       └─ SessionDependencies / Pairing / TunnelClient / Attachment
            ├─ native: locho_flutter → Rust → loopback → package:http
            └─ browser: package:http adapter → Dart JS interop
                         → tool/web-bridge.mjs → locho_web → WASM
```

The shared package's transport state enum and native adapter were separated so
native FFI imports never enter the browser compilation. Its default native entry
point remains usable. Our entry point supplies the browser implementation on web.
`http://locho.invalid` is an internal routing marker in that implementation; every
request is intercepted and translated into a Locho SDK operation, never sent as
a browser network request. JSON requests and SSE own separate cancellable HTTP
clients while sharing the same tunnel.

## Verification

```sh
flutter analyze
flutter test
npm test
flutter build web --no-web-resources-cdn
npm run test:browser
```

The Playwright tests use installed Google Chrome by default. For another browser
installation, adjust `playwright.config.mjs`.

- Flutter widget test: pairing/login/notes/logout/forget with an injected transport.
- Node bridge tests: request/connection cancellation, late results, incremental
  streaming and independent status unsubscribe.
- Browser tests: real published Rust WASM ticket parsing and IndexedDB, plus the
  compiled Flutter UI/JS adapter flow using a deterministic SDK double, including
  SSE and reload restoration. These do not by themselves establish live relay or
  physical-device connectivity.

The reference repositories supply real host/device acceptance tooling. Run that
separately when a compatible host, API runtime, mobile toolchain and devices are
available.

### Real tunnel integration tests

The optional live suite starts a disposable reference API and a real Locho host,
generates an in-memory ticket, and cleans up its temporary data/processes. The
browser test uses the published SDK without a transport mock and verifies an SSE
update from a second real Locho client. It requires reachable discovery/relay
services. The native test checks CRUD, SSE admission, foreground suspend/resume,
and secure session restoration on a connected device or simulator.

Prepare the host and API once (from this directory):

```sh
export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/rustup/bin:$PATH"
git clone https://github.com/trchopan/locho.git ../locho
# Clone ../locho_sdk_examples as described above if not already present.
cargo build --locked --manifest-path ../locho/Cargo.toml --bin locho -j 4
npm --prefix ../locho_sdk_examples ci
npm --prefix ../locho_sdk_examples run build
```

Then run:

```sh
npm run test:live
LOCHO_DEVICE=<device-id> npm run test:native
```

Both commands default to `../locho/target/debug/locho`; set `LOCHO_BINARY` to use
another compatible executable. `test:native` sends its ephemeral ticket through a
mode-0600 temporary Dart-defines file and removes it afterward. The test binary
temporarily replaces the app on the selected device. Rebuild/run `lib/main.dart`
afterward to return to the normal UI. The default `npm run test:browser` suite
skips the live-network test; `test:live` explicitly enables it and requires Node 24.

### Previously verified in this workspace

These results precede the packaging-only move into `packages/locho_notes`.
Tests were not rerun while preparing the repository for publication.

- Analysis, the application widget test, all 28 shared example tests, and four
  JavaScript bridge tests pass.
- Standard JavaScript and Flutter `--wasm` web builds succeed. Chrome tests pass
  against both build modes.
- Android ARM64/x86_64 debug APK and iOS simulator app builds succeed.
- The real browser relay integration test passes: pairing, authenticated CRUD,
  cross-client live updates, and server-side logout.
- The native integration test passes on Android API 36 (ARM64 emulator) and
  iOS 26.3.1 (iPhone 17 Pro simulator), including secure session restoration and
  foreground lifecycle recovery.
- The reference CLI's direct TCP health/login/notes/incremental-SSE smoke passes.
- These are local/emulator/simulator results, not physical-device or production
  availability guarantees.
