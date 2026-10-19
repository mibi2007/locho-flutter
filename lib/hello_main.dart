import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_widget_from_html_core/flutter_widget_from_html_core.dart';

import 'hello/controller.dart';
import 'platform/native.dart'
    if (dart.library.js_interop) 'platform/browser.dart'
    as platform;

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const HelloApp());
}

class HelloApp extends StatelessWidget {
  const HelloApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Hello over Locho',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF00796B)),
      scaffoldBackgroundColor: const Color(0xFFF4F7F6),
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
      ),
    ),
    home: const HelloScreen(),
  );
}

class HelloScreen extends StatefulWidget {
  const HelloScreen({super.key});

  @override
  State<HelloScreen> createState() => _HelloScreenState();
}

class _HelloScreenState extends State<HelloScreen> with WidgetsBindingObserver {
  final ticket = TextEditingController();
  late final controller = HelloController(platform.createDependencies());

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      controller.disconnect();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    controller.dispose();
    ticket.dispose();
    super.dispose();
  }

  Widget panel({required Widget child}) => Card(
    margin: const EdgeInsets.only(bottom: 20),
    child: Padding(padding: const EdgeInsets.all(24), child: child),
  );

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final theme = Theme.of(context);
      return Scaffold(
        appBar: AppBar(
          title: const Text('Hello over Locho'),
          backgroundColor: theme.colorScheme.surface,
        ),
        body: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: ListView(
              padding: const EdgeInsets.all(24),
              children: [
                Text(
                  'A private page. An encrypted tunnel.',
                  style: theme.textTheme.headlineMedium,
                ),
                const SizedBox(height: 12),
                const Text(
                  'Connect with a Locho ticket, then fetch the HTML served by '
                  'Caddy on the host’s 127.0.0.1:8080.',
                ),
                const SizedBox(height: 20),
                panel(
                  child: const Wrap(
                    spacing: 12,
                    runSpacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Chip(label: Text('Flutter')),
                      Icon(Icons.arrow_forward, size: 18),
                      Chip(label: Text('Locho SDK · encrypted tunnel')),
                      Icon(Icons.arrow_forward, size: 18),
                      Chip(label: Text('Caddy · :8080')),
                    ],
                  ),
                ),
                panel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: 12,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text('Connection', style: theme.textTheme.titleLarge),
                          Chip(
                            avatar: Icon(
                              controller.state == 'Connected'
                                  ? Icons.link
                                  : Icons.link_off,
                              size: 18,
                            ),
                            label: Text(controller.state),
                          ),
                          if (controller.service.isNotEmpty)
                            Text('Service: ${controller.service}'),
                        ],
                      ),
                      const SizedBox(height: 16),
                      TextField(
                        controller: ticket,
                        obscureText: true,
                        autocorrect: false,
                        enableSuggestions: false,
                        enableIMEPersonalizedLearning: false,
                        decoration: const InputDecoration(
                          labelText: 'Attachment ticket',
                          hintText: 'locho1:…',
                          helperText:
                              'Generated with: locho share hello --ticket',
                        ),
                        onSubmitted: (_) => connect(),
                      ),
                      const SizedBox(height: 20),
                      Wrap(
                        spacing: 12,
                        runSpacing: 12,
                        children: [
                          FilledButton.icon(
                            onPressed: controller.busy ? null : connect,
                            icon: const Icon(Icons.link),
                            label: const Text('Connect'),
                          ),
                          FilledButton.tonalIcon(
                            onPressed: controller.canFetch
                                ? () => unawaited(controller.fetchPage())
                                : null,
                            icon: const Icon(Icons.download),
                            label: const Text('Fetch page'),
                          ),
                          OutlinedButton.icon(
                            onPressed: controller.hasConnection
                                ? controller.disconnect
                                : null,
                            icon: const Icon(Icons.link_off),
                            label: const Text('Disconnect'),
                          ),
                        ],
                      ),
                      if (controller.busy) ...[
                        const SizedBox(height: 20),
                        const LinearProgressIndicator(),
                      ],
                      if (controller.message.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        Text(
                          controller.message,
                          style: TextStyle(color: theme.colorScheme.error),
                        ),
                      ],
                    ],
                  ),
                ),
                if (controller.html case final html?) ...[
                  Wrap(
                    spacing: 12,
                    runSpacing: 8,
                    children: [
                      Chip(label: Text('HTTP ${controller.statusCode}')),
                      Chip(label: Text(controller.contentType)),
                      Chip(
                        label: Text('${controller.elapsed!.inMilliseconds} ms'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Page preview', style: theme.textTheme.titleLarge),
                        const SizedBox(height: 12),
                        if (controller.isHtml)
                          HtmlWidget(html)
                        else
                          SelectableText(html),
                      ],
                    ),
                  ),
                  panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Raw response', style: theme.textTheme.titleLarge),
                        const SizedBox(height: 16),
                        SelectableText(
                          html,
                          style: const TextStyle(fontFamily: 'monospace'),
                        ),
                      ],
                    ),
                  ),
                ] else
                  panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Your page will appear here',
                          style: theme.textTheme.titleLarge,
                        ),
                        const SizedBox(height: 12),
                        const Text('Paste a ticket → Connect → Fetch page'),
                        const SizedBox(height: 12),
                        const Text(
                          'Requests go through the Locho SDK. The browser does '
                          'not fetch localhost:8080 directly.',
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      );
    },
  );

  void connect() {
    if (controller.busy) return;
    final value = ticket.text;
    ticket.clear();
    unawaited(controller.connect(value));
  }
}
