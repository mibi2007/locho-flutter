import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tool/e2e',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4187',
    channel: 'chrome',
    headless: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'node tool/serve-web.mjs',
    url: 'http://127.0.0.1:4187/__test.html',
    reuseExistingServer: false,
  },
});
