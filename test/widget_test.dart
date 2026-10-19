import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:locho_notes/main.dart';
import 'package:locho_notes/session.dart';
import 'package:locho_notes/transport.dart';

class _Memory implements Credentials {
  String? record;
  @override
  Future<String?> read() async => record;
  @override
  Future<void> replace(String? value) async => record = value;
}

class _Ticket implements Pairing {
  @override
  String get hostId => 'a' * 64;
  @override
  String get service => 'notes';
  @override
  String get serviceType => 'tcp';
  @override
  Future<String> export() async => 'synthetic-ticket';
}

class _Tunnel implements TunnelClient, Attachment {
  @override
  Future<Attachment> attach(Pairing ticket) async => this;
  @override
  Uri get httpBaseUri => Uri.parse('http://locho.invalid');
  @override
  Stream<LochoState> get states => const Stream.empty();
  @override
  Future<void> close() async {}
}

void main() {
  testWidgets('shared UI pairs, logs in, edits notes, logs out and forgets', (
    tester,
  ) async {
    final storage = _Memory();
    final notes = <Map<String, dynamic>>[];
    final paths = <String>[];
    final session = NotesSession(
      storage,
      dependencies: SessionDependencies(
        parse: (_) async => _Ticket(),
        create: () async => _Tunnel(),
        httpClient: () => MockClient((request) async {
          final path = request.url.path;
          paths.add(path);
          Object response;
          if (path == '/health') {
            response = {'service': 'locho-notes', 'apiVersion': 1};
          } else if (path == '/auth/login') {
            response = {
              'token': 'synthetic-token',
              'user': {'id': '1', 'email': 'alice@example.test'},
            };
          } else if (path == '/auth/logout') {
            return http.Response('', 204);
          } else if (path == '/api/notes' && request.method == 'POST') {
            final input = jsonDecode(request.body) as Map<String, dynamic>;
            notes.add({'id': '1', ...input});
            response = {'note': notes.last};
          } else if (path == '/api/notes/1' && request.method == 'DELETE') {
            notes.clear();
            return http.Response('', 204);
          } else {
            response = {'notes': notes};
          }
          return http.Response(jsonEncode(response), 200);
        }),
      ),
    );
    // A tall surface keeps the full notes form accessible in this flow.
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(NotesApp(session: session));
    await tester.pumpAndSettle();
    expect(find.text('Locho Notes'), findsOneWidget);
    expect(storage.record, isNull);
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('Attachment ticket')))
          .obscureText,
      isTrue,
    );
    await tester.enterText(
      find.byKey(const ValueKey('Attachment ticket')),
      'synthetic-ticket',
    );
    await tester.tap(find.text('Pair'));
    await tester.pumpAndSettle();
    expect(session.phase, 'login');
    await tester.enterText(
      find.byKey(const ValueKey('Email')),
      'alice@example.test',
    );
    await tester.enterText(
      find.byKey(const ValueKey('Password')),
      'synthetic-password',
    );
    await tester.tap(find.text('Login'));
    await tester.pumpAndSettle();
    expect(session.phase, 'notes');
    await tester.enterText(
      find.byKey(const ValueKey('Title')),
      'Flutter everywhere',
    );
    await tester.enterText(
      find.byKey(const ValueKey('Body')),
      'One shared UI.',
    );
    await tester.tap(find.text('Create note'));
    await tester.pumpAndSettle();
    expect(notes.single['title'], 'Flutter everywhere');
    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();
    expect(notes, isEmpty);
    await session.setRemember(true);
    expect(storage.record, contains('synthetic-token'));
    await tester.tap(find.text('Logout'));
    await tester.pumpAndSettle();
    expect(storage.record, isNot(contains('synthetic-token')));
    expect(paths, contains('/auth/logout'));
    await tester.tap(find.text('Forget homelab'));
    await tester.pumpAndSettle();
    expect(storage.record, isNull);
    expect(session.phase, 'unpaired');
    await tester.pumpWidget(const SizedBox.shrink());
    final closing = session.close();
    await tester.pumpAndSettle();
    await closing;
  });
}
