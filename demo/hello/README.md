# Hello over Locho

```text
Chrome: Flutter web on :5050
  → locho_web JavaScript + Rust WASM
  → encrypted Locho tunnel
  → Locho host
  → Caddy on host 127.0.0.1:8080
  → <h1>Hello</h1>
```

## Start everything

From `flutter_app/`:

```sh
flutter pub get
npm ci
npm run prepare:web
npm run demo:hello
```

Requires `caddy` and `flutter` on PATH and the built CLI at
`../locho/target/debug/locho`. Override the CLI with `LOCHO_BINARY` if needed.
Caddy can be installed on this Mac using `brew install caddy`.

The supervisor starts Caddy on **127.0.0.1:8080**, creates a Locho host with its
own ignored state directory, generates the `hello` TCP attachment ticket, starts
Flutter web on **http://127.0.0.1:5050**, and opens Chrome. Port 5050 is used because
macOS Control Center already occupies 5000 on this machine.

On macOS the ticket is copied to the clipboard. It is also saved with mode 0600
in `.local/hello/ticket.txt`. To copy it again:

```sh
npm run demo:hello:ticket
```

Paste it into **Attachment ticket**, click **Connect**, wait for **Connected**,
then click **Fetch page**. The app displays HTTP status, content type, rendered
HTML, and the raw response. This is a static HTML preview, not a full browser
with proxied scripts/assets/navigation.

Stop all services started by this supervisor with Ctrl+C, or from another terminal:

```sh
npm run demo:hello:stop
```

For background use:

```sh
npm run demo:hello -- background
```

The demo does not launch tests, perform automatic page fetches, or reuse/stop
other Flutter sessions. You fetch the page manually in the UI.

## Start each service manually

Use separate terminals, all in `flutter_app/`:

```sh
caddy run --config demo/hello/Caddyfile --adapter caddyfile
```

```sh
LOCHO_STATE_DIR="$PWD/.local/hello/host-state" \
  ../locho/target/debug/locho host --config demo/hello/locho.toml
```

```sh
LOCHO_STATE_DIR="$PWD/.local/hello/host-state" \
  ../locho/target/debug/locho share hello --config demo/hello/locho.toml --ticket
```

```sh
flutter run -d web-server --web-port 5050 --web-hostname 127.0.0.1 \
  --target lib/hello_main.dart
```

The browser's SDK attaches directly using the ticket. A CLI `locho attach`
process is not needed. `127.0.0.1:8080` refers to Caddy on the **host machine**;
Flutter's request to `/` uses the SDK transport instead of fetching that address
directly. Discovery/relay services must be reachable from Chrome and the host.

The same Flutter entrypoint can run on Android/iOS with their native Locho
adapter. The original notes application remains the `lib/main.dart` entrypoint.
