import 'package:flutter/material.dart';
import 'package:locho_notes/main.dart';
import 'package:locho_notes/session.dart';

import 'platform/native.dart'
    if (dart.library.js_interop) 'platform/browser.dart'
    as platform;

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(NotesApp(session: createSession()));
}

NotesSession createSession() => NotesSession(
  platform.createCredentials(),
  dependencies: platform.createDependencies(),
);
