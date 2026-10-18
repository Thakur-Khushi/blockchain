// Descriptive wellness analytics. Computed on the server from records the caller
// is authorised to read. Outputs are descriptive statistics, never clinical claims.

const DAY_MS = 86400000;
export const MAX_RANGE_DAYS = 366;

const toTime = (d) => Date.parse(`${d}T00:00:00Z`);
const toDate = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d, n) => toDate(toTime(d) + n * DAY_MS);
export const daysBetween = (from, to) => Math.round((toTime(to) - toTime(from)) / DAY_MS) + 1;

function round1(n) {
  return n == null ? null : Math.round(n * 10) / 10;
}

function avg(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

// Monday of the ISO week containing `d`.
function weekStart(d) {
  const day = new Date(toTime(d)).getUTCDay(); // 0 = Sunday
  return addDays(d, -((day + 6) % 7));
}

function trend(entries, key, { higherIsBetter }) {
  if (entries.length < 4) return { direction: 'insufficient_data', change: null };
  const mid = Math.floor(entries.length / 2);
  const first = avg(entries.slice(0, mid).map((e) => e[key]));
  const second = avg(entries.slice(mid).map((e) => e[key]));
  const change = round1(second - first);
  if (Math.abs(change) < 0.5) return { direction: 'stable', change };
  const up = change > 0;
  return { direction: up === higherIsBetter ? 'improving' : 'worsening', change };
}

function group(entries, keyFn, rangeDays) {
  const buckets = new Map();
  for (const d of rangeDays) {
    const k = keyFn(d);
    if (!buckets.has(k)) buckets.set(k, { days: 0, entries: [] });
    buckets.get(k).days += 1;
  }
  for (const e of entries) buckets.get(keyFn(e.entryDate))?.entries.push(e);
  return [...buckets.entries()].map(([key, b]) => ({
    key,
    days: b.days,
    checkIns: b.entries.length,
    avgMood: round1(avg(b.entries.map((e) => e.mood))),
    avgStress: round1(avg(b.entries.map((e) => e.stress))),
  }));
}

/**
 * @param {Array<{entryDate, mood, stress, tags}>} entries  readable records in range
 * @param {{from: string, to: string, excluded?: number}} range
 */
export function computeAnalytics(entries, { from, to, excluded = 0, audience = 'patient' }) {
  const sorted = [...entries].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  const totalDays = daysBetween(from, to);
  const rangeDays = Array.from({ length: totalDays }, (_, i) => addDays(from, i));
  const byDate = new Map(sorted.map((e) => [e.entryDate, e]));

  const daily = rangeDays.map((d) => ({ date: d, mood: byDate.get(d)?.mood ?? null, stress: byDate.get(d)?.stress ?? null }));
  const weekly = group(sorted, weekStart, rangeDays).map(({ key, ...rest }) => ({ weekStart: key, ...rest }));
  const monthly = group(sorted, (d) => d.slice(0, 7), rangeDays).map(({ key, ...rest }) => ({ month: key, ...rest }));

  // Streaks: consecutive check-in days. The current streak may end yesterday if
  // today's check-in has not happened yet.
  let longest = 0;
  let run = 0;
  for (const d of rangeDays) {
    run = byDate.has(d) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  let cursor = byDate.has(to) ? to : addDays(to, -1);
  while (cursor >= from && byDate.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  const moods = sorted.map((e) => e.mood);
  const stresses = sorted.map((e) => e.stress);
  const tagCounts = new Map();
  for (const e of sorted) for (const t of e.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));

  const summary = {
    avgMood: round1(avg(moods)),
    avgStress: round1(avg(stresses)),
    minMood: moods.length ? Math.min(...moods) : null,
    maxMood: moods.length ? Math.max(...moods) : null,
    minStress: stresses.length ? Math.min(...stresses) : null,
    maxStress: stresses.length ? Math.max(...stresses) : null,
    moodTrend: trend(sorted, 'mood', { higherIsBetter: true }),
    stressTrend: trend(sorted, 'stress', { higherIsBetter: false }),
    lowMoodDays: moods.filter((m) => m <= 3).length,
    highStressDays: stresses.filter((s) => s >= 8).length,
    topTags,
  };

  const completion = {
    days: totalDays,
    checkIns: sorted.length,
    rate: totalDays ? Math.round((sorted.length / totalDays) * 100) / 100 : 0,
    currentStreak: current,
    longestStreak: longest,
  };

  return { range: { from, to }, daily, weekly, monthly, completion, summary, insights: describe(summary, completion, audience), excludedRecords: excluded };
}

// Plain-language, non-clinical descriptions of the numbers above, phrased for the
// patient themselves or for their therapist.
function describe(s, c, audience) {
  const w =
    audience === 'therapist'
      ? { subj: 'The patient', poss: 'Their', is: 'is', reach: false }
      : { subj: 'You', poss: 'Your', is: 'are', reach: true };
  if (!c.checkIns) return ['No check-ins were recorded in this period.'];
  const out = [`${w.subj} checked in on ${c.checkIns} of ${c.days} days (${Math.round(c.rate * 100)}%).`];
  out.push(`${w.poss} average self-rated mood was ${s.avgMood}/10 and average stress ${s.avgStress}/10.`);
  const t = s.moodTrend;
  if (t.direction === 'improving') out.push(`Mood ratings were higher in the second half of this period (+${t.change}).`);
  else if (t.direction === 'worsening') out.push(`Mood ratings were lower in the second half of this period (${t.change}).`);
  else if (t.direction === 'stable') out.push('Mood ratings stayed fairly steady across this period.');
  const st = s.stressTrend;
  if (st.direction === 'improving') out.push(`Stress ratings eased in the second half of this period (${st.change}).`);
  else if (st.direction === 'worsening') out.push(`Stress ratings rose in the second half of this period (+${st.change}).`);
  if (s.highStressDays) out.push(`Stress was rated 8 or higher on ${s.highStressDays} day${s.highStressDays > 1 ? 's' : ''}.`);
  if (s.topTags.length) out.push(`Most used tags: ${s.topTags.slice(0, 3).map((t) => t.tag).join(', ')}.`);
  if (c.currentStreak >= 3) out.push(`${w.subj} ${w.is} on a ${c.currentStreak}-day check-in streak.`);
  if (s.lowMoodDays >= 3) {
    out.push(
      w.reach
        ? 'Several low-mood days were recorded. If things feel hard, consider talking to a professional or someone you trust.'
        : `Several low-mood days were recorded (${s.lowMoodDays} days rated 3 or below).`,
    );
  }
  return out;
}
