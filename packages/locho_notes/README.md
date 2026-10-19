# Shared Locho notes package

This unpublished, in-repository Dart package contains the notes UI, session
controller, SSE handling, and native transport adapter used by the Flutter app.
It makes the application buildable without a sibling `locho_sdk_examples` checkout.

## Provenance

Adapted from [`trchopan/locho_sdk_examples/apps/flutter`](https://github.com/trchopan/locho_sdk_examples/tree/57f95ff94835de5525e77e182d9921245dba773b/apps/flutter)
at commit `57f95ff94835de5525e77e182d9921245dba773b`, including the local
platform-neutral transport changes made for this application:

- `transport.dart` defines SDK-independent connection states and interfaces.
- `transport_native.dart` maps the published native SDK to those interfaces.
- `transport_unavailable.dart` keeps native FFI out of browser builds.
- `session.dart` depends on the shared interface instead of native SDK types.
- The native SDK dependency is the published `locho_flutter` **0.1.0-beta.2**.

Only the reusable runtime Dart files are included. Native platform projects,
generated output, credentials, and SDK source are not copied from the example.
The root application's browser adapter supplies the web implementation.

The root app imports `main.dart`, `session.dart`, and `transport.dart` from this
package. Launch the root `lib/main.dart` to get automatic platform selection;
this package's original `main()` entrypoint uses the Android/iOS adapter.
