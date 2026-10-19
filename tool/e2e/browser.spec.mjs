import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { openApp, typeField } from './helpers.mjs';

test('published Rust WASM parses tickets and browser storage round-trips', async ({ page }) => {
  await page.goto('/__test.html');
  const result = await page.evaluate(async () => {
    await import('/locho/bridge.js');
    const payload = btoa(JSON.stringify({
      host_id: '01'.repeat(32), capability: 'api:tcp:test-secret', peer_relay_urls: [],
    })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    const ticket = await lochoBridge.parse(`locho1:${payload}`);
    let invalidRejected = false;
    try { await lochoBridge.parse('not-a-ticket'); } catch { invalidRejected = true; }
    await lochoBridge.replaceCredentials('synthetic-storage-record');
    const saved = await lochoBridge.readCredentials();
    await lochoBridge.replaceCredentials(null);
    return {
      hostId: ticket.hostId, service: ticket.service, serviceType: ticket.serviceType,
      invalidRejected, saved, cleared: await lochoBridge.readCredentials(),
    };
  });
  expect(result).toEqual({
    hostId: '01'.repeat(32), service: 'api', serviceType: 'tcp', invalidRejected: true,
    saved: 'synthetic-storage-record', cleared: null,
  });
});

test('Flutter web pairs, authenticates, edits notes, receives SSE and restores a session', async ({ page }) => {
  const bundled = await build({
    entryPoints: ['tool/browser-fixture.mjs'], bundle: true, format: 'esm',
    platform: 'browser', target: 'es2022', write: false,
  });
  await page.route('**/locho/bridge.js', (route) => route.fulfill({
    contentType: 'text/javascript', body: bundled.outputFiles[0].text,
  }));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const leakedRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('locho.invalid')) leakedRequests.push(request.url());
  });
  const type = (name, value) => typeField(page, name, value);
  await openApp(page);
  await type('Attachment ticket', 'synthetic-ticket');
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  await type('Email', 'alice@example.test');
  await type('Password', 'synthetic-password');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page.getByText('Live updates: live', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create note', exact: true })).toBeEnabled();
  await type('Title', 'Flutter browser note');
  await type('Body', 'Through the Dart-to-JavaScript adapter');
  await page.getByRole('button', { name: 'Create note', exact: true }).click();
  await expect(page.getByRole('group', { name: /^Flutter browser note / })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await type('Title', 'Edited browser note');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('group', { name: /^Edited browser note / })).toBeVisible();
  await page.evaluate(() => fixture.createNote());
  await expect(page.getByRole('group', { name: /^Remote update / })).toBeVisible();
  // Persist through the real IndexedDB implementation, then validate restoration.
  await page.getByRole('switch', { name: 'Remember this device' }).click();
  await expect.poll(() => page.evaluate(() => lochoBridge.readCredentials())).toContain('synthetic-token');
  await openApp(page);
  await expect(page.getByText('Notes for alice@example.test', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect.poll(() => page.evaluate(() => fixture.eventStreams)).toBe(0);
  await expect.poll(() => page.evaluate(() => lochoBridge.readCredentials())).not.toContain('synthetic-token');
  await page.getByRole('button', { name: 'Forget homelab', exact: true }).click();
  await expect.poll(() => page.evaluate(() => lochoBridge.readCredentials())).toBeNull();
  expect(leakedRequests).toEqual([]);
  expect(errors).toEqual([]);
});
