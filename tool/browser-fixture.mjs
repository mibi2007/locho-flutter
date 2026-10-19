import { createBridge, createCredentialStore } from './web-bridge.mjs';

// Deterministic SDK double for testing the compiled Dart/JS boundary and UI.
// Separate tests load the real published WASM ticket parser.
const notes = [], eventStreams = new Set();
const user = { id: 'alice', email: 'alice@example.test' };
let nextId = 0;
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});
function notify(operation, noteId) {
  for (const controller of eventStreams) controller.enqueue(new TextEncoder().encode(
    `event: note.changed\ndata: ${JSON.stringify({ operation, noteId })}\n\n`,
  ));
}
globalThis.fixture = {
  requests: [],
  createNote() {
    const note = { id: String(++nextId), title: 'Remote update', body: 'Arrived through SSE' };
    notes.push(note);
    notify('created', note.id);
  },
  get eventStreams() { return eventStreams.size; },
};
const sdk = {
  LochoTicket: {
    async parse(text) {
      if (text !== 'synthetic-ticket') throw new Error('Invalid ticket');
      return { metadata: { hostId: 'a'.repeat(64), service: 'notes', serviceType: 'tcp' }, export: () => text };
    },
  },
  LochoClient: {
    async connect({ signal }) {
      if (signal.aborted) throw new Error('Cancelled');
      let closed = false;
      return {
        subscribeStatus(listener) {
          listener({ state: 'connected' });
          return async () => {};
        },
        async fetch(path, options) {
          if (closed || options.signal.aborted) throw new Error('Closed');
          globalThis.fixture.requests.push({ path, method: options.method });
          if (path === '/health') return json({ service: 'locho-notes', apiVersion: 1 });
          if (path === '/auth/login') return json({ token: 'synthetic-token', user });
          if (path === '/auth/logout') return new Response(null, { status: 204 });
          if (options.headers.Authorization !== 'Bearer synthetic-token') return json({}, 401);
          if (path === '/api/me') return json({ user });
          if (path === '/api/notes' && options.method === 'POST') {
            const note = { id: String(++nextId), ...JSON.parse(new TextDecoder().decode(options.body)) };
            notes.push(note);
            notify('created', note.id);
            return json({ note }, 201);
          }
          if (path.startsWith('/api/notes/') && options.method === 'PATCH') {
            const note = notes.find((n) => n.id === path.split('/').pop());
            Object.assign(note, JSON.parse(new TextDecoder().decode(options.body)));
            notify('updated', note.id);
            return json({ note });
          }
          if (path.startsWith('/api/notes/') && options.method === 'DELETE') {
            const index = notes.findIndex((n) => n.id === path.split('/').pop());
            const [note] = notes.splice(index, 1);
            notify('deleted', note.id);
            return new Response(null, { status: 204 });
          }
          return json({ notes });
        },
        async fetchStream(path, options) {
          if (options.headers.Authorization !== 'Bearer synthetic-token') return json({}, 401);
          let streamController;
          return new Response(new ReadableStream({
            start(controller) {
              streamController = controller;
              eventStreams.add(controller);
              controller.enqueue(new TextEncoder().encode(': connected\n\n'));
            },
            cancel() { eventStreams.delete(streamController); },
          }), { headers: { 'content-type': 'text/event-stream' } });
        },
        async close() { closed = true; },
      };
    },
  },
};
const store = createCredentialStore();
globalThis.lochoBridge = {
  ...createBridge(sdk),
  readCredentials: () => store.read(),
  replaceCredentials: (value) => store.replace(value),
};
