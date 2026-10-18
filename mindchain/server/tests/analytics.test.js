import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import request from 'supertest';
import { bearer, clearDb, createUser, startDb, stopDb } from './helpers/db.js';
import { createFakeChain } from './helpers/fakeChain.js';
import { createApp } from '../src/app.js';
import { AuditEvent } from '../src/models/AuditEvent.js';
import { WellnessRecord } from '../src/models/WellnessRecord.js';
import { addDays, computeAnalytics } from '../src/services/analyticsService.js';
import { toCsv } from '../src/services/reportService.js';

const e = (entryDate, mood, stress, tags = []) => ({ entryDate, mood, stress, tags });

describe('computeAnalytics (pure)', () => {
  it('builds daily, weekly and monthly series over the full range', () => {
    // 2026-09-28 is a Monday.
    const a = computeAnalytics([e('2026-09-28', 4, 6), e('2026-09-30', 6, 4), e('2026-10-05', 8, 2)], { from: '2026-09-28', to: '2026-10-11' });
    assert.equal(a.daily.length, 14);
    assert.deepEqual(a.daily[0], { date: '2026-09-28', mood: 4, stress: 6 });
    assert.deepEqual(a.daily[1], { date: '2026-09-29', mood: null, stress: null });
    assert.deepEqual(a.weekly.map((w) => [w.weekStart, w.checkIns, w.avgMood, w.days]), [
      ['2026-09-28', 2, 5, 7],
      ['2026-10-05', 1, 8, 7],
    ]);
    assert.deepEqual(a.monthly.map((m) => [m.month, m.checkIns, m.avgMood, m.days]), [
      ['2026-09', 2, 5, 3],
      ['2026-10', 1, 8, 11],
    ]);
  });

  it('computes completion and streaks', () => {
    const to = '2026-10-10';
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-07', '2026-10-08', '2026-10-09'];
    const a = computeAnalytics(days.map((d) => e(d, 5, 5)), { from: '2026-10-01', to });
    assert.equal(a.completion.days, 10);
    assert.equal(a.completion.checkIns, 7);
    assert.equal(a.completion.rate, 0.7);
    assert.equal(a.completion.longestStreak, 4);
    // Today (10th) missing: streak counts back from yesterday.
    assert.equal(a.completion.currentStreak, 3);
  });

  it('summarises averages, extremes, trends and tags descriptively', () => {
    const entries = [
      e('2026-10-01', 3, 8, ['work']), e('2026-10-02', 3, 9, ['work', 'sleep']),
      e('2026-10-03', 7, 4, ['exercise']), e('2026-10-04', 8, 3, ['exercise', 'work']),
    ];
    const a = computeAnalytics(entries, { from: '2026-10-01', to: '2026-10-04' });
    assert.equal(a.summary.avgMood, 5.3);
    assert.equal(a.summary.avgStress, 6);
    assert.equal(a.summary.minMood, 3);
    assert.equal(a.summary.maxMood, 8);
    assert.deepEqual(a.summary.moodTrend, { direction: 'improving', change: 4.5 });
    assert.deepEqual(a.summary.stressTrend, { direction: 'improving', change: -5 });
    assert.equal(a.summary.highStressDays, 2);
    assert.deepEqual(a.summary.topTags[0], { tag: 'work', count: 3 });
    assert.ok(a.insights.some((s) => s.includes('4 of 4 days')));
    assert.ok(a.insights.every((s) => !/diagnos|depress|disorder/i.test(s)));
  });

  it('handles empty ranges and too-little data for trends', () => {
    const a = computeAnalytics([], { from: '2026-10-01', to: '2026-10-07' });
    assert.equal(a.completion.checkIns, 0);
    assert.equal(a.summary.avgMood, null);
    assert.equal(a.summary.moodTrend.direction, 'insufficient_data');
    assert.deepEqual(a.insights, ['No check-ins were recorded in this period.']);
  });

  it('adds a supportive (non-diagnostic) note after several low-mood days', () => {
    const a = computeAnalytics([1, 2, 3].map((n) => e(`2026-10-0${n}`, 2, 7)), { from: '2026-10-01', to: '2026-10-03' });
    assert.ok(a.insights.some((s) => s.includes('consider talking to a professional')));
  });
});

describe('CSV export safety', () => {
  it('neutralises spreadsheet formulas and escapes quotes/newlines', () => {
    const csv = toCsv([{ a: '=HYPERLINK("x")', b: 'line1\nline2', c: ['t1', 't2'], d: '+1', e: '-2', f: '@x' }], ['a', 'b', 'c', 'd', 'e', 'f']);
    const [, row] = csv.split('\r\n');
    assert.ok(row.startsWith(`"'=HYPERLINK(""x"")"`));
    assert.ok(csv.includes('"line1\nline2"'));
    assert.ok(row.includes(",t1;t2,'+1,'-2,'@x"));
  });
});

describe('Analytics and export API', () => {
  let chain;
  let app;
  before(startDb);
  after(stopDb);
  beforeEach(async () => {
    await clearDb();
    chain = createFakeChain();
    app = createApp({ chain });
  });

  const today = () => new Date().toISOString().slice(0, 10);
  async function seed(token, days) {
    for (const [offset, mood, stress, journal] of days) {
      await request(app)
        .post('/api/wellness')
        .set(bearer(token))
        .send({ entryDate: addDays(today(), -offset), mood, stress, journal: journal ?? '' })
        .expect(201);
    }
  }

  it('returns analytics for the authenticated patient only', async () => {
    const alice = await createUser();
    const bob = await createUser();
    await seed(alice.token, [[0, 8, 2], [1, 6, 4]]);
    await seed(bob.token, [[0, 1, 10]]);

    const a = await request(app).get('/api/wellness/analytics').set(bearer(alice.token)).expect(200);
    assert.equal(a.body.analytics.completion.checkIns, 2);
    assert.equal(a.body.analytics.summary.avgMood, 7);
    assert.equal(a.body.analytics.daily.length, 30);
    const b = await request(app).get('/api/wellness/analytics').set(bearer(bob.token)).expect(200);
    assert.equal(b.body.analytics.summary.avgMood, 1);
  });

  it('validates ranges and excludes tampered records', async () => {
    const { token } = await createUser();
    await seed(token, [[0, 8, 2], [1, 6, 4]]);
    await request(app).get(`/api/wellness/analytics?from=${today()}&to=${addDays(today(), -5)}`).set(bearer(token)).expect(400);
    await request(app).get(`/api/wellness/analytics?from=${addDays(today(), -400)}&to=${today()}`).set(bearer(token)).expect(400);

    await WellnessRecord.updateOne({ entryDate: today() }, { digest: '0x' + 'f'.repeat(64) });
    const res = await request(app).get('/api/wellness/analytics').set(bearer(token)).expect(200);
    assert.equal(res.body.analytics.completion.checkIns, 1);
    assert.equal(res.body.analytics.excludedRecords, 1);
  });

  it('denies analytics endpoints to other roles', async () => {
    const therapist = await createUser({ role: 'therapist', verificationStatus: 'verified' });
    const admin = await createUser({ role: 'admin' });
    await request(app).get('/api/wellness/analytics').set(bearer(therapist.token)).expect(403);
    await request(app).get('/api/wellness/analytics').set(bearer(admin.token)).expect(403);
  });

  it('gives therapists patient analytics only with live consent', async () => {
    const pw = Wallet.createRandom().address.toLowerCase();
    const tw = Wallet.createRandom().address.toLowerCase();
    const patient = await createUser({ walletAddress: pw });
    const therapist = await createUser({ role: 'therapist', verificationStatus: 'verified', walletAddress: tw });
    await seed(patient.token, [[0, 7, 3]]);
    const url = `/api/therapists/patients/${patient.user._id}/analytics`;

    await request(app).get(url).set(bearer(therapist.token)).expect(403);
    chain.grant(pw, tw);
    const res = await request(app).get(url).set(bearer(therapist.token)).expect(200);
    assert.equal(res.body.analytics.summary.avgMood, 7);
    assert.ok(res.body.analytics.insights[0].startsWith('The patient checked in'));
    assert.equal(await AuditEvent.countDocuments({ eventType: 'record_access', detail: 'analytics' }), 1);
    chain.revoke(pw, tw);
    await request(app).get(url).set(bearer(therapist.token)).expect(403);
  });

  it('exports the patient\'s own records as JSON and CSV', async () => {
    const alice = await createUser();
    const bob = await createUser();
    await seed(alice.token, [[0, 8, 2, '=cmd|"/c calc"!A1'], [1, 6, 4, 'normal day']]);
    await seed(bob.token, [[0, 1, 10, 'bob private']]);

    const json = await request(app).get('/api/wellness/export?format=json').set(bearer(alice.token)).expect(200);
    assert.match(json.headers['content-disposition'], /attachment; filename="mindchain-export-/);
    assert.equal(json.body.records.length, 2);
    assert.equal(json.body.records[1].mood, 8);
    assert.equal(JSON.stringify(json.body).includes('bob private'), false);

    const csv = await request(app).get('/api/wellness/export?format=csv').set(bearer(alice.token)).expect(200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.ok(csv.text.includes(`"'=cmd|""/c calc""!A1"`));
    assert.equal(csv.text.includes('bob private'), false);
    assert.equal(await AuditEvent.countDocuments({ eventType: 'records_exported' }), 2);
    await request(app).get('/api/wellness/export?format=xml').set(bearer(alice.token)).expect(400);
  });
});
