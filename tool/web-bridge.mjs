/** A small ABI for Dart JS interop. SDK handles never become serialized tickets. */
export function createBridge(sdk, initialize = async () => {}) {
  const tickets = new WeakMap();
  return {
    async parse(text) {
      await initialize();
      const ticket = await sdk.LochoTicket.parse(text);
      const { hostId, service, serviceType } = ticket.metadata;
      const result = { hostId, service, serviceType, export: () => ticket.export() };
      tickets.set(result, ticket);
      return result;
    },
    createClient() {
      const connectingAbort = new AbortController();
      const requests = new Set();
      let client, connecting, closing, clientShutdown, closed = false;
      const closeClient = (connected) => clientShutdown ??= connected.close();
      const requireClient = () => {
        if (closed || !client) throw new Error('Locho connection unavailable');
        return client;
      };
      return {
        async attach(ticket) {
          if (closed || connecting) throw new Error('Locho connection unavailable');
          const raw = tickets.get(ticket);
          if (!raw) throw new Error('Invalid Locho ticket handle');
          connecting = sdk.LochoClient.connect({ ticket: raw, signal: connectingAbort.signal });
          client = await connecting;
          if (closed) {
            await closeClient(client);
            throw new Error('Locho connection closed');
          }
        },
        subscribe(onState, onError) {
          return requireClient().subscribeStatus(
            (status) => onState(status.state),
            { onError: () => onError() },
          );
        },
        open(path, method, headers, body, streaming) {
          const owner = requireClient();
          const abort = new AbortController();
          let reader, stopping, finished = false;
          const finish = () => { finished = true; requests.delete(handle); };
          const cancel = () => stopping ??= (async () => {
            abort.abort();
            try { await reader?.cancel(); } catch { /* Already failed/closed. */ }
            finish();
          })();
          const handle = { cancel, response: undefined };
          requests.add(handle);
          handle.response = (async () => {
            try {
              const options = {
                method, headers: JSON.parse(headers), body, signal: abort.signal,
                ...(streaming ? { setupTimeoutMs: 15000, idleTimeoutMs: 75000 } : { timeoutMs: 15000 }),
              };
              const response = await (streaming ? owner.fetchStream(path, options) : owner.fetch(path, options));
              if (abort.signal.aborted || closed) {
                await response.body?.cancel();
                throw new Error('Locho request cancelled');
              }
              reader = response.body?.getReader();
              if (!reader) finish();
              return {
                status: response.status,
                headers: JSON.stringify(Object.fromEntries(response.headers)),
                async read() {
                  if (finished) return { done: true, bytes: new Uint8Array() };
                  try {
                    const next = await reader.read();
                    if (next.done) finish();
                    return { done: next.done, bytes: next.value ?? new Uint8Array() };
                  } catch (error) { finish(); throw error; }
                },
              };
            } catch (error) { finish(); throw error; }
          })();
          return handle;
        },
        close() {
          if (closing) return closing;
          closed = true;
          connectingAbort.abort();
          closing = (async () => {
            const cancellations = [...requests].map((request) => request.cancel());
            let connected = client;
            if (!connected) {
              try { connected = await connecting; }
              catch { /* A failed/aborted connection has no client owner. */ }
            }
            await Promise.all([
              ...cancellations,
              connected ? closeClient(connected) : Promise.resolve(),
            ]);
          })();
          return closing;
        },
      };
    },
  };
}

/** Opt-in browser persistence. Only called by the shared session's remember flow. */
export function createCredentialStore(indexedDB = globalThis.indexedDB) {
  let opening;
  function open() {
    return opening ??= new Promise((resolve, reject) => {
      if (!indexedDB) return reject(new Error('Browser storage unavailable'));
      const request = indexedDB.open('flutter-locho-notes-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('credentials');
      request.onerror = () => { opening = undefined; reject(new Error('Browser storage unavailable')); };
      request.onblocked = () => { opening = undefined; reject(new Error('Browser storage blocked')); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = undefined; };
        resolve(db);
      };
    });
  }
  async function transaction(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('credentials', mode);
      const request = action(tx.objectStore('credentials'));
      tx.oncomplete = () => resolve(request.result ?? null);
      tx.onerror = tx.onabort = () => reject(new Error('Browser storage failed'));
    });
  }
  return {
    read: () => transaction('readonly', (store) => store.get('session')),
    replace: (value) => transaction('readwrite', (store) =>
      value == null ? store.delete('session') : store.put(value, 'session')),
  };
}
