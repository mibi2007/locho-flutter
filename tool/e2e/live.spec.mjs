import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { openApp, typeField } from './helpers.mjs';

test('Flutter web uses real Locho relay transport for notes and live updates', async ({ page }) => {
  test.skip(process.env.LOCHO_LIVE !== '1', 'Run npm run test:live with Node 24 and a built Locho host.');
  test.setTimeout(240000);
  // Dynamic import keeps the default browser suite usable on Node 20.
  const { acceptanceFixture } = await import('../../../locho_sdk_examples/scripts/acceptance-fixture.mjs');
  const fixture = await acceptanceFixture(process.env.LOCHO_BINARY ?? resolve('../locho/target/debug/locho'));
  const errors = [], leakedRequests = [];
  page.on('pageerror', () => errors.push('Browser runtime error'));
  page.on('request', (request) => {
    if (request.url().includes('locho.invalid')) leakedRequests.push('Unintercepted request');
  });
  try {
    await openApp(page);
    await typeField(page, 'Attachment ticket', fixture.ticket);
    await page.getByRole('button', { name: 'Pair', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible({ timeout: 60000 });
    await typeField(page, 'Email', 'alice@example.test');
    await typeField(page, 'Password', 'alice-local-demo-only');
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(page.getByText('Live updates: live', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Create note', exact: true })).toBeEnabled();
    await typeField(page, 'Title', 'Real tunnel note');
    await typeField(page, 'Body', 'Flutter → JS interop → WASM → relay → private API');
    await page.getByRole('button', { name: 'Create note', exact: true }).click();
    await expect(page.getByRole('group', { name: /^Real tunnel note / })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await typeField(page, 'Title', 'Edited through real tunnel');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('group', { name: /^Edited through real tunnel / })).toBeVisible();

    // A second real SDK client mutates the same account; only SSE updates the UI.
    // Credentials and the ephemeral ticket stay in memory and are never printed.
    const peer = await page.evaluate(async (ticketText) => {
      const ticket = await lochoBridge.parse(ticketText);
      const client = lochoBridge.createClient();
      await client.attach(ticket);
      async function request(path, body, token) {
        const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
        const pending = client.open(path, 'POST', JSON.stringify(headers), new TextEncoder().encode(JSON.stringify(body)), false);
        const response = await pending.response;
        const chunks = [];
        while (true) {
          const chunk = await response.read();
          if (chunk.done) break;
          chunks.push(...chunk.bytes);
        }
        if (response.status >= 400) throw new Error('Peer API request rejected');
        return JSON.parse(new TextDecoder().decode(new Uint8Array(chunks)));
      }
      try {
        const login = await request('/auth/login', { email: 'alice@example.test', password: 'alice-local-demo-only' });
        await request('/api/notes', { title: 'Live peer update', body: 'Received without pressing refresh' }, login.token);
        return 'created';
      } finally { await client.close(); }
    }, fixture.ticket);
    expect(peer).toBe('created');
    await expect(page.getByRole('group', { name: /^Live peer update / })).toBeVisible({ timeout: 30000 });
    await page.getByRole('group', { name: /^Edited through real tunnel / })
      .getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('group', { name: /^Edited through real tunnel / })).toHaveCount(0);
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await expect(page.getByText('Logged out.', { exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Forget homelab', exact: true }).click();
    expect(errors).toEqual([]);
    expect(leakedRequests).toEqual([]);
  } finally {
    await page.goto('/__test.html').catch(() => {});
    await fixture.cleanup();
  }
});
