import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:locho_notes/main.dart';
import 'package:locho_notes/session.dart';
import 'package:flutter_app/main.dart' as app;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('native tunnel, notes, secure restoration and lifecycle', (
    tester,
  ) async {
    const ticket = String.fromEnvironment('LOCHO_TICKET');
    if (ticket.isEmpty) throw StateError('Run through npm run test:native');
    final sessions = <NotesSession>[];
    NotesSession create() {
      final session = app.createSession();
      sessions.add(session);
      return session;
    }

    // Assertions expose only phase/count information, never ticket/token contents.
    final session = create();
    await session.storage.replace(null);
    await tester.pumpWidget(NotesApp(session: session));
    await tester.pumpAndSettle();
    expect(find.text('Locho Notes'), findsOneWidget);
    try {
      await session.pair(ticket);
      expect(session.phase, 'login');
      await session.setRemember(true);
      await session.login('alice@example.test', 'alice-local-demo-only');
      expect(session.phase, 'notes');
      expect(session.live, 'live');
      await session.save('Native tunnel note', 'Unicode 🌍', null);
      expect(session.notes.length, 1);
      final id = session.notes.single['id'] as String;
      await session.save('Native tunnel note', 'Updated on device', id);
      expect(session.notes.single['body'], 'Updated on device');

      session.suspend();
      await session.resume();
      expect(session.phase, 'notes');
      // Unmount the first app to close its transport before restoring a new owner.
      await tester.pumpWidget(const SizedBox.shrink());
      await session.close();
      final restored = create();
      await restored.restore();
      expect(restored.phase, 'notes');
      expect(restored.notes.length, 1);
      await restored.setRemember(false);
      expect(await restored.storage.read(), isNull);
      await restored.remove(id);
      expect(restored.notes, isEmpty);
      await restored.logout();
      expect(restored.message, 'Logged out.');
      await restored.forget();
      expect(await restored.storage.read(), isNull);
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      for (final session in sessions) {
        await session.close();
      }
      await session.storage.replace(null);
    }
  });
}
