import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:locho_notes/transport.dart';

/// A generic HTML request over the existing SDK adapters; no notes API required.
class HelloController extends ChangeNotifier {
  HelloController(this.dependencies);

  final SessionDependencies dependencies;
  TunnelClient? _tunnel;
  Attachment? _attachment;
  http.Client? _http;
  StreamSubscription<LochoState>? _watch;
  Future<void> _closing = Future.value();
  int _generation = 0;
  bool _disposed = false;

  bool busy = false;
  String state = 'Disconnected';
  String service = '';
  String message = '';
  int? statusCode;
  String contentType = '';
  String? html;
  Duration? elapsed;

  bool get canFetch => !busy && _attachment != null && state == 'Connected';
  bool get hasConnection => _tunnel != null || busy;
  bool get isHtml => contentType.toLowerCase().startsWith('text/html');

  bool _current(int generation) => !_disposed && generation == _generation;
  void _changed() {
    if (!_disposed) notifyListeners();
  }

  void _clearResponse() {
    statusCode = null;
    contentType = '';
    html = null;
    elapsed = null;
  }

  Future<void> _cleanup(
    StreamSubscription<LochoState>? watch,
    TunnelClient? tunnel,
  ) async {
    try {
      await watch?.cancel().timeout(const Duration(seconds: 15));
    } catch (_) {
      // Still close the owner if status unsubscribe cannot complete.
    }
    try {
      await tunnel?.close().timeout(const Duration(seconds: 15));
    } catch (_) {
      // UI ownership has already been invalidated; stale results are ignored.
    }
  }

  int _release() {
    final generation = ++_generation;
    final watch = _watch, tunnel = _tunnel;
    _watch = null;
    _tunnel = null;
    _attachment = null;
    _http?.close();
    _http = null;
    _closing = _closing.then((_) => _cleanup(watch, tunnel));
    return generation;
  }

  Future<void> connect(String value) async {
    if (_disposed || busy) return;
    if (value.trim().isEmpty) {
      message = 'Paste the locho1: ticket generated for the hello TCP service.';
      _changed();
      return;
    }
    final generation = _release();
    busy = true;
    state = 'Connecting';
    service = '';
    message = '';
    _clearResponse();
    _changed();
    try {
      final ticket = await dependencies.parse(value.trim());
      if (!_current(generation)) return;
      if (ticket.serviceType != 'tcp') {
        throw const FormatException('A TCP ticket is required');
      }
      await _closing;
      if (!_current(generation)) return;
      final tunnel = await dependencies.create();
      if (!_current(generation)) {
        await _cleanup(null, tunnel);
        return;
      }
      _tunnel = tunnel;
      final attachment = await tunnel.attach(ticket);
      if (!_current(generation)) return;
      _attachment = attachment;
      _http = dependencies.httpClient();
      service = ticket.service;
      state = 'Connected';
      _watch = attachment.states.listen(
        (status) {
          if (!_current(generation)) return;
          state = switch (status) {
            LochoState.starting || LochoState.connecting => 'Connecting',
            LochoState.connected => 'Connected',
            LochoState.reconnecting => 'Reconnecting',
            LochoState.failed => 'Failed',
            LochoState.closing || LochoState.closed => 'Disconnected',
          };
          if (status == LochoState.failed || status == LochoState.closed) {
            message = 'The tunnel stopped. Disconnect and connect again.';
            _http?.close();
            _clearResponse();
          }
          _changed();
        },
        onError: (_) {
          if (!_current(generation)) return;
          state = 'Failed';
          message = 'Connection status is unavailable. Connect again.';
          _http?.close();
          _clearResponse();
          _changed();
        },
      );
    } catch (_) {
      if (_current(generation)) {
        _release();
        busy = false;
        state = 'Disconnected';
        message = 'Could not connect. Check the TCP ticket, host, and network.';
        _changed();
      }
    } finally {
      if (_current(generation)) {
        busy = false;
        _changed();
      }
    }
  }

  Future<void> fetchPage() async {
    final client = _http, attachment = _attachment;
    if (!canFetch || client == null || attachment == null) return;
    final generation = _generation;
    busy = true;
    message = '';
    _clearResponse();
    _changed();
    final stopwatch = Stopwatch()..start();
    final abort = Completer<void>();
    final timer = Timer(const Duration(seconds: 20), () => abort.complete());
    try {
      final request = http.AbortableRequest(
        'GET',
        attachment.httpBaseUri.resolve('/'),
        abortTrigger: abort.future,
      )..followRedirects = false;
      request.headers['Accept'] = 'text/html';
      final response = await client.send(request);
      final bytes = <int>[];
      await for (final chunk in response.stream) {
        if (!_current(generation)) return;
        if (bytes.length + chunk.length > 1024 * 1024) {
          client.close();
          throw const FormatException('Response exceeds demo limit');
        }
        bytes.addAll(chunk);
      }
      if (!_current(generation)) return;
      statusCode = response.statusCode;
      contentType = response.headers['content-type'] ?? 'Not supplied';
      html = utf8.decode(bytes, allowMalformed: true);
      elapsed = stopwatch.elapsed;
      if (statusCode != 200) {
        message = 'The upstream returned HTTP $statusCode.';
      }
    } catch (_) {
      if (_current(generation)) {
        message = 'Request failed. Check that Caddy and the Locho host are running, then retry.';
        client.close();
        _http = dependencies.httpClient();
      }
    } finally {
      timer.cancel();
      if (_current(generation)) {
        busy = false;
        _changed();
      }
    }
  }

  void disconnect() {
    if (_disposed) return;
    _release();
    busy = false;
    state = 'Disconnected';
    service = '';
    message = '';
    _clearResponse();
    _changed();
  }

  @override
  void dispose() {
    _disposed = true;
    _release();
    super.dispose();
  }
}
