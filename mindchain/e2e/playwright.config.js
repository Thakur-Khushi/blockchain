import fs from 'node:fs';
import { defineConfig } from '@playwright/test';

// Uses an installed browser (Edge, else Chrome) so no browser download is needed.
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const channel = process.env.E2E_BROWSER_CHANNEL ?? (process.platform !== 'win32' || fs.existsSync(EDGE) ? 'msedge' : 'chrome');

export default defineConfig({
  testDir: './tests',
  outputDir: './.tmp/results',
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5174',
    channel,
    viewport: { width: 1366, height: 860 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
