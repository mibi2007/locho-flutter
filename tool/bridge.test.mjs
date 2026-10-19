import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from './web-bridge.mjs';

function fixture(overrides = {}) {
  const calls = [], controllers = [];
  let closes = 0, unsubscribes = 0;
  const client = {
    subscribeStatus(listener) {
      listener({ state: 'connected' });
      return async () => { unsubscribes++; };
    },
    async fetch(path, options) {
      calls.push({ path, options });
      return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
    },
    async fetchStream(path, options) {
      calls.push({ path, options });
      return new Response(new ReadableStream({
        start(controller) { controllers.push(controller); },
        cancel() { calls.push({ cancelled: true }); },
      }), { headers: { 'content-type': 'text/event-stream' } });
    },
    async close() { closes++; },
    ...overrides.client,
  };
  const sdk = {
    LochoTicket: { async parse(text) {
      assert.equal(text, 'synthetic');
      return { metadata: { hostId: 'a'.repeat(64), service: 'notes', serviceType: 'tcp' }, export: () => 'canonical' };
    } },
    LochoClient: { connect: overrides.connect ?? (async () => client) },
  };
  return {
    bridge: createBridge(sdk), calls, controllers,
    get closes() { return closes; },
    get unsubscribes() { return unsubscribes; },
  };
}

test('metadata, authenticated JSON, incremental SSE and independent unsubscribe', async () => {
  const f = fixture();
  const ticket = await f.bridge.parse('synthetic');
  assert.equal(ticket.serviceType, 'tcp');
  assert.equal(ticket.export(), 'canonical');
  const client = f.bridge.createClient();
  await client.attach(ticket);
  const states = [];
  const unsubscribe = client.subscribe((state) => states.push(state));
  assert.deepEqual(states, ['connected']);
  const request = client.open('/api/notes?q=1', 'POST', '{"authorization":"Bearer synthetic"}', new TextEncoder().encode('{}'), false);
  const response = await request.response;
  assert.equal(response.status, 200);
  const first = await response.read();
  assert.deepEqual(JSON.parse(new TextDecoder().decode(first.bytes)), { ok: true });
  assert.equal((await response.read()).done, true);
  assert.equal(f.calls[0].options.headers.authorization, 'Bearer synthetic');
  const event = client.open('/api/events', 'GET', '{}', new Uint8Array(), true);
  const events = await event.response;
  f.controllers[0].enqueue(new TextEncoder().encode(': heartbeat\n\n'));
  assert.equal(new TextDecoder().decode((await events.read()).bytes), ': heartbeat\n\n');
  // Cancelling a blocked read must release it without closing the connection.
  const pending = events.read();
  await event.cancel();
  assert.equal((await pending).done, true);
  await unsubscribe();
  assert.equal(f.unsubscribes, 1);
  assert.equal(f.closes, 0);
  await client.close();
  await client.close();
  assert.equal(f.closes, 1);
});

test('closing during attach aborts connection admission and closes a late client', async () => {
  let resolve, signal;
  const f = fixture({ connect: (options) => {
    signal = options.signal;
    return new Promise((done) => { resolve = done; });
  } });
  const client = f.bridge.createClient();
  const ticket = await f.bridge.parse('synthetic');
  const attaching = client.attach(ticket);
  const rejected = assert.rejects(attaching, /closed/);
  const closing = client.close();
  assert.equal(signal.aborted, true);
  let closes = 0;
  resolve({ close: async () => { closes++; } });
  await Promise.all([rejected, closing]);
  assert.equal(closes, 1);
  assert.throws(() => client.open('/health', 'GET', '{}', new Uint8Array(), false), /unavailable/);
});

test('cancellation before response headers cancels a late response body', async () => {
  let resolve, cancelled = false;
  const f = fixture({ client: { fetch: () => new Promise((done) => { resolve = done; }) } });
  const client = f.bridge.createClient();
  await client.attach(await f.bridge.parse('synthetic'));
  const request = client.open('/health', 'GET', '{}', new Uint8Array(), false);
  const rejected = assert.rejects(request.response, /cancelled/);
  await request.cancel();
  resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await rejected;
  assert.equal(cancelled, true);
  await client.close();
});

test('closing a tunnel cancels all its active streaming requests', async () => {
  const f = fixture();
  const client = f.bridge.createClient();
  await client.attach(await f.bridge.parse('synthetic'));
  const requests = [0, 1].map(() => client.open('/api/events', 'GET', '{}', new Uint8Array(), true));
  const responses = await Promise.all(requests.map((r) => r.response));
  const reads = responses.map((r) => r.read());
  await client.close();
  assert.ok((await Promise.all(reads)).every((r) => r.done));
  assert.equal(f.calls.filter((c) => c.cancelled).length, 2);
});
