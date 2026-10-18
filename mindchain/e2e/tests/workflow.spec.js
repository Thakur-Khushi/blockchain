// Full MindChain workflow in a real browser against a real Hardhat chain, API and
// MongoDB. Run through `npm test` (run-e2e.mjs starts and stops the stack).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { injectWallet } from './wallet.js';

const SCREENS = path.resolve('.tmp/screens');
fs.mkdirSync(SCREENS, { recursive: true });
const shot = (page, name, fullPage = true) => page.screenshot({ path: path.join(SCREENS, `${name}.png`), fullPage });

const run = Date.now().toString(36);
const PASSWORD = 'Passw0rd-e2e-1';
const therapist = { name: 'Dr Meera Rao', email: `therapist-${run}@example.test`, specialization: 'Anxiety and stress' };
const patient = { name: 'Asha Patel', email: `patient-${run}@example.test` };
const JOURNAL = `Walked by the lake and felt calmer (${run})`;

const localDate = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.describe.serial('MindChain end-to-end workflow', () => {
  let adminPage;
  let therapistPage;
  let patientPage;

  test.beforeAll(async ({ browser }) => {
    const adminCtx = await browser.newContext();
    const therapistCtx = await browser.newContext();
    const patientCtx = await browser.newContext();
    // Hardhat dev accounts #2 (therapist) and #1 (patient) act as MetaMask wallets.
    await injectWallet(therapistCtx, 2);
    await injectWallet(patientCtx, 1);
    adminPage = await adminCtx.newPage();
    therapistPage = await therapistCtx.newPage();
    patientPage = await patientCtx.newPage();
  });

  test('therapist registers, sees pending verification and links a wallet', async () => {
    const page = therapistPage;
    await page.goto('/register');
    await page.locator('label', { hasText: 'Support my patients' }).click();
    await page.getByLabel('Full name').fill(therapist.name);
    await page.getByLabel('Email').fill(therapist.email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByLabel('License number').fill('PSY-55821');
    await page.getByLabel('Licensing body').fill('State Psychology Board');
    await page.getByLabel('Specialization').fill(therapist.specialization);
    await page.getByLabel('Years of experience').fill('8');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('heading', { name: 'Professional verification' })).toBeVisible();
    await expect(page.getByText('Verification pending')).toBeVisible();

    await page.goto('/wallet');
    await page.getByRole('button', { name: 'Link this wallet' }).click();
    await expect(page.getByText('MetaMask account verified')).toBeVisible();
  });

  test('admin verifies the therapist', async () => {
    const page = adminPage;
    await page.goto('/login');
    await page.getByLabel('Email').fill(process.env.E2E_ADMIN_EMAIL);
    await page.getByLabel('Password').fill(process.env.E2E_ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
    await shot(page, '01-admin-dashboard');

    await page.goto('/admin/therapists');
    const card = page.locator('div.rounded-2xl', { hasText: therapist.email });
    await card.getByRole('button', { name: 'Verify', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Verify therapist' }).click();
    await expect(page.getByText(`${therapist.name} verified.`)).toBeVisible();
  });

  test('patient registers, links wallet and registers on-chain', async () => {
    const page = patientPage;
    await page.goto('/register');
    await page.getByLabel('Full name').fill(patient.name);
    await page.getByLabel('Email').fill(patient.email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: /Hello, Asha/ })).toBeVisible();

    await page.goto('/wallet');
    await page.getByRole('button', { name: 'Link this wallet' }).click();
    await expect(page.getByText('MetaMask account verified')).toBeVisible();
    await page.getByRole('button', { name: 'Register on MindChain' }).click();
    await expect(page.getByText('Registered on MindChain')).toBeVisible();
    await shot(page, '02-wallet');
  });

  test('patient checks in, anchors the record on-chain and verifies it', async () => {
    const page = patientPage;
    await page.goto('/patient/check-in');
    await page.locator('label', { has: page.locator('input[name="mood"][value="7"]') }).click();
    await page.locator('#stress').fill('4');
    await page.getByLabel('Private journal (optional)').fill(JOURNAL);
    await page.getByLabel(/Tags/).fill('nature');
    await page.getByLabel(/Tags/).press('Enter');
    await page.getByRole('button', { name: 'Save check-in' }).click();
    await expect(page.getByText('Check-in saved and encrypted.')).toBeVisible();

    await page.getByRole('button', { name: 'Anchor on blockchain' }).click();
    await expect(page.getByText('Record fingerprint anchored and confirmed on-chain.')).toBeVisible();
    await expect(page.getByText('Transaction confirmed on-chain')).toBeVisible();
    await shot(page, '03-check-in-anchored');

    // Seed two weeks of history through the API (as the logged-in patient).
    const token = await page.evaluate(() => sessionStorage.getItem('mindchain_token'));
    const moods = [5, 6, 4, 6, 7, 5, 8, 6, 7, 3, 6, 7, 8];
    for (let i = 1; i <= moods.length; i += 1) {
      if (i === 4 || i === 9) continue; // a couple of missed days
      const res = await page.request.post('/api/wellness', {
        headers: { Authorization: `Bearer ${token}` },
        data: { entryDate: localDate(-i), mood: moods[i - 1], stress: 10 - moods[i - 1], journal: `Day -${i}`, tags: i % 3 ? ['work'] : ['sleep'] },
      });
      expect(res.status()).toBe(201);
    }

    await page.goto('/patient/integrity');
    const row = page.locator('tbody tr').first();
    await row.getByRole('button', { name: 'Verify' }).click();
    await expect(row.getByText('Verified', { exact: true })).toBeVisible();
    await shot(page, '04a-integrity-table');
    await row.getByText('details').click();
    await expect(page.getByRole('dialog').getByText('Fingerprint matches the blockchain')).toBeVisible();
    await shot(page, '04-integrity-verified');
    await page.keyboard.press('Escape');
  });

  test('patient grants access; the therapist can read records and the progress report', async () => {
    await patientPage.goto('/patient/consent');
    await patientPage.getByRole('button', { name: 'Grant access' }).click();
    const dialog = patientPage.getByRole('dialog');
    await dialog.locator('label', { hasText: therapist.name }).click();
    await dialog.getByRole('button', { name: 'Sign in MetaMask' }).click();
    await expect(patientPage.getByText(`${therapist.name} can now view your wellness records for 30 days.`)).toBeVisible();
    await expect(patientPage.locator('li', { hasText: therapist.name }).getByText('Active')).toBeVisible();
    await shot(patientPage, '05-consent-granted');

    const page = therapistPage;
    await page.goto('/therapist/patients');
    await page.locator('div.rounded-2xl', { hasText: patient.name }).getByRole('button', { name: 'View records' }).click();
    await expect(page.getByText(JOURNAL)).toBeVisible();
    await page.getByRole('tab', { name: 'Progress report' }).click();
    await expect(page.getByText(/The patient checked in on \d+ of 30 days/)).toBeVisible();
    await expect(page.locator('.recharts-line').first()).toBeVisible();
    await shot(page, '06-therapist-progress-report');
  });

  test('patient revokes access; the therapist is denied on the next request', async () => {
    await patientPage.goto('/patient/consent');
    await patientPage.locator('li', { hasText: therapist.name }).getByRole('button', { name: 'Revoke' }).click();
    await patientPage.getByRole('dialog').getByRole('button', { name: 'Revoke in MetaMask' }).click();
    await expect(patientPage.getByText(`Access revoked for ${therapist.name}`)).toBeVisible();

    await therapistPage.reload();
    await expect(therapistPage.getByText('Access not available')).toBeVisible();
    await therapistPage.goto('/therapist/patients');
    await expect(therapistPage.getByText('No patients with active consent')).toBeVisible();
  });

  test('patient requests an appointment and the therapist confirms it', async () => {
    await patientPage.goto('/patient/appointments');
    await patientPage.getByRole('button', { name: 'Request appointment' }).first().click();
    const dialog = patientPage.getByRole('dialog');
    await dialog.getByLabel('Therapist', { exact: true }).selectOption({ label: `${therapist.name} — ${therapist.specialization}` });
    await dialog.getByLabel('Note for the therapist (optional)').fill('First session, please.');
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(patientPage.getByText('Appointment requested.')).toBeVisible();

    await therapistPage.goto('/therapist/appointments');
    const card = therapistPage.locator('div.rounded-2xl', { hasText: patient.name });
    await expect(card.getByText('First session, please.')).toBeVisible();
    await card.getByRole('button', { name: 'Confirm' }).click();
    await therapistPage.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
    await expect(therapistPage.getByText('Appointment confirmed.')).toBeVisible();

    await patientPage.reload();
    await expect(patientPage.getByText('Confirmed', { exact: true })).toBeVisible();
    await shot(patientPage, '07-appointments');
  });

  test('patient analytics renders charts, summaries and table views', async () => {
    const page = patientPage;
    await page.goto('/patient/analytics');
    await expect(page.getByText(/You checked in on \d+ of 30 days/)).toBeVisible();
    await expect(page.locator('.recharts-line')).toHaveCount(2);
    await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible();
    await shot(page, '08-analytics-30d');
    await page.getByRole('button', { name: 'Show table' }).first().click();
    await expect(page.getByRole('columnheader', { name: 'Mood' }).first()).toBeVisible();
    await page.getByRole('button', { name: '90 days' }).click();
    await expect(page.getByText(/You checked in on \d+ of 90 days/)).toBeVisible();
  });

  test('patient sees the access log, dashboard and export', async () => {
    const page = patientPage;
    await page.goto('/patient/activity');
    await expect(page.getByText('Records viewed by therapist').first()).toBeVisible();
    await expect(page.getByText('Access revoked').first()).toBeVisible();

    await page.goto('/patient/journal');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^mindchain-export-.*\.csv$/);
    const csv = fs.readFileSync(await file.path(), 'utf8');
    expect(csv).toContain(JOURNAL);

    await page.goto('/patient');
    await expect(page.getByText("Today's check-in", { exact: true })).toBeVisible();
    await shot(page, '09-patient-dashboard');
  });

  test('admin audit log shows events without journal content', async () => {
    await adminPage.goto('/admin/audit');
    await expect(adminPage.locator('table').getByText('Records viewed by therapist').first()).toBeVisible();
    expect(await adminPage.content()).not.toContain(JOURNAL);
    await shot(adminPage, '10-admin-audit');
  });

  test('layout works on a phone-sized screen', async () => {
    const page = patientPage;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/patient');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible();
    await shot(page, '11-mobile-nav', false);
    await page.getByRole('dialog', { name: 'Navigation' }).getByRole('link', { name: 'Analytics' }).click();
    await expect(page.locator('.recharts-line').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await shot(page, '12-mobile-analytics');
  });
});
