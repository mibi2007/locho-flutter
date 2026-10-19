import 'package:http/http.dart' as http;
import 'transport_native.dart'
    if (dart.library.js_interop) 'transport_unavailable.dart'
    as platform;

/// Shared application states; no native SDK types enter the browser build.
enum LochoState {
  starting,
  connecting,
  connected,
  reconnecting,
  failed,
  closing,
  closed,
}

abstract interface class Pairing {
  String get hostId;
  String get service;
  String get serviceType;
  Future<String> export();
}

abstract interface class Attachment {
  Uri get httpBaseUri;
  Stream<LochoState> get states;
}

abstract interface class TunnelClient {
  Future<Attachment> attach(Pairing ticket);
  Future<void> close();
}

class SessionDependencies {
  final Future<Pairing> Function(String) parse;
  final Future<TunnelClient> Function() create;
  final http.Client Function() httpClient;

  /// Dedicated streaming clients; null allows JSON-only injected test transports.
  final http.Client Function()? eventClient;
  final Duration eventIdleTimeout;
  final Duration eventRetryBase;
  final double Function()? eventRandom;
  final Duration cleanupTimeout;
  final Duration requestTimeout;
  const SessionDependencies({
    required this.parse,
    required this.create,
    required this.httpClient,
    this.eventClient,
    this.eventIdleTimeout = const Duration(seconds: 75),
    this.eventRetryBase = const Duration(seconds: 1),
    this.eventRandom,
    this.cleanupTimeout = const Duration(seconds: 15),
    this.requestTimeout = const Duration(seconds: 15),
  });
  factory SessionDependencies.native() => platform.createDependencies();
}
