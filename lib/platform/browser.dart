import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:locho_notes/session.dart';
import 'package:locho_notes/transport.dart';

@JS('lochoBridge')
external _Bridge get _bridge;

extension type _Bridge(JSObject _) implements JSObject {
  external JSPromise<_TicketHandle> parse(JSString text);
  external _ClientHandle createClient();
  external JSPromise<JSString?> readCredentials();
  external JSPromise<JSAny?> replaceCredentials(JSString? value);
}

extension type _TicketHandle(JSObject _) implements JSObject {
  external JSString get hostId;
  external JSString get service;
  external JSString get serviceType;
  @JS('export')
  external JSString exportTicket();
}

extension type _ClientHandle(JSObject _) implements JSObject {
  external JSPromise<JSAny?> attach(_TicketHandle ticket);
  external JSFunction subscribe(JSFunction listener, JSFunction onError);
  external _RequestHandle open(
    JSString path,
    JSString method,
    JSString headers,
    JSUint8Array body,
    JSBoolean streaming,
  );
  external JSPromise<JSAny?> close();
}

extension type _RequestHandle(JSObject _) implements JSObject {
  external JSPromise<_ResponseHandle> get response;
  external JSPromise<JSAny?> cancel();
}

extension type _ResponseHandle(JSObject _) implements JSObject {
  external JSNumber get status;
  external JSString get headers;
  external JSPromise<_Chunk> read();
}

extension type _Chunk(JSObject _) implements JSObject {
  external JSBoolean get done;
  external JSUint8Array get bytes;
}

Credentials createCredentials() => _BrowserCredentials();

SessionDependencies createDependencies() {
  _BrowserTunnel? current;
  return SessionDependencies(
    parse: (text) async =>
        _BrowserTicket(await _bridge.parse(text.toJS).toDart),
    create: () async => current = _BrowserTunnel(_bridge.createClient()),
    httpClient: () => _TunnelHttpClient(current!),
    eventClient: () => _TunnelHttpClient(current!, streaming: true),
  );
}

class _BrowserCredentials implements Credentials {
  @override
  Future<String?> read() async =>
      (await _bridge.readCredentials().toDart)?.toDart;
  @override
  Future<void> replace(String? value) async {
    await _bridge.replaceCredentials(value?.toJS).toDart;
  }
}

class _BrowserTicket implements Pairing {
  final _TicketHandle handle;
  _BrowserTicket(this.handle);
  @override
  String get hostId => handle.hostId.toDart;
  @override
  String get service => handle.service.toDart;
  @override
  String get serviceType => handle.serviceType.toDart;
  @override
  Future<String> export() async => handle.exportTicket().toDart;
}

class _BrowserTunnel implements TunnelClient, Attachment {
  final _ClientHandle handle;
  _BrowserTunnel(this.handle);
  @override
  Future<Attachment> attach(Pairing ticket) async {
    await handle.attach((ticket as _BrowserTicket).handle).toDart;
    return this;
  }

  // A routing marker only. All requests are intercepted by _TunnelHttpClient;
  // the browser never fetches this URL or a localhost companion service.
  @override
  Uri get httpBaseUri => Uri.parse('http://locho.invalid');
  @override
  Stream<LochoState> get states {
    JSFunction? unsubscribe;
    late final StreamController<LochoState> controller;
    controller = StreamController<LochoState>(
      onListen: () {
        try {
          unsubscribe = handle.subscribe(
            ((JSString state) {
              try {
                controller.add(LochoState.values.byName(state.toDart));
              } catch (_) {
                controller.addError(StateError('Invalid Locho status'));
              }
            }).toJS,
            (() => controller.addError(
              StateError('Locho status unavailable'),
            )).toJS,
          );
        } catch (_) {
          controller.addError(StateError('Locho status unavailable'));
        }
      },
      onCancel: () async {
        final result = unsubscribe?.callAsFunction();
        if (result != null) await (result as JSPromise<JSAny?>).toDart;
      },
    );
    return controller.stream;
  }

  @override
  Future<void> close() async {
    await handle.close().toDart;
  }
}

/// Adapts Locho's fetch-like transport to the example's existing HTTP/session code.
/// Closing an HTTP client cancels its own requests, not the shared tunnel.
class _TunnelHttpClient extends http.BaseClient {
  final _BrowserTunnel tunnel;
  final bool streaming;
  final Set<_RequestHandle> _active = {};
  bool _closed = false;
  _TunnelHttpClient(this.tunnel, {this.streaming = false});

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final uri = request.url;
    if (_closed || uri.origin != tunnel.httpBaseUri.origin) {
      throw http.ClientException('Locho HTTP client unavailable', uri);
    }
    final bytes = await request.finalize().toBytes();
    if (_closed) throw http.ClientException('Locho HTTP client closed', uri);
    final handle = tunnel.handle.open(
      '${uri.path}${uri.hasQuery ? '?${uri.query}' : ''}'.toJS,
      request.method.toJS,
      jsonEncode(request.headers).toJS,
      Uint8List.fromList(bytes).toJS,
      streaming.toJS,
    );
    _active.add(handle);
    var finished = false, aborted = false;
    Future<void> cancel() async {
      if (finished) return;
      aborted = true;
      await handle.cancel().toDart;
    }

    if (request is http.Abortable) {
      unawaited(request.abortTrigger?.then((_) => cancel()));
    }
    try {
      final response = await handle.response.toDart;
      if (aborted || _closed) throw http.RequestAbortedException(uri);
      final headers = Map<String, String>.from(
        jsonDecode(response.headers.toDart) as Map,
      );
      late final StreamController<List<int>> body;
      Completer<void>? resumed;
      var cancelled = false;
      Future<void> pump() async {
        try {
          while (!cancelled) {
            if (resumed != null) await resumed!.future;
            if (cancelled) break;
            final chunk = await response.read().toDart;
            if (cancelled) break;
            if (aborted || _closed) throw http.RequestAbortedException(uri);
            if (chunk.done.toDart) break;
            body.add(chunk.bytes.toDart);
          }
        } catch (_) {
          if (!cancelled) {
            body.addError(
              aborted || _closed
                  ? http.RequestAbortedException(uri)
                  : http.ClientException('Locho response stream failed', uri),
            );
          }
        } finally {
          finished = true;
          _active.remove(handle);
          await body.close();
        }
      }

      body = StreamController<List<int>>(
        onListen: () => unawaited(pump()),
        onPause: () => resumed ??= Completer<void>(),
        onResume: () {
          resumed?.complete();
          resumed = null;
        },
        onCancel: () async {
          cancelled = true;
          resumed?.complete();
          resumed = null;
          await cancel();
          _active.remove(handle);
        },
      );
      return http.StreamedResponse(
        body.stream,
        response.status.toDartInt,
        headers: headers,
        request: request,
      );
    } catch (_) {
      final wasAborted = aborted || _closed;
      await cancel();
      finished = true;
      _active.remove(handle);
      if (wasAborted) throw http.RequestAbortedException(uri);
      throw http.ClientException('Locho request failed', uri);
    }
  }

  @override
  void close() {
    if (_closed) return;
    _closed = true;
    for (final handle in _active) {
      unawaited(handle.cancel().toDart);
    }
    _active.clear();
  }
}
