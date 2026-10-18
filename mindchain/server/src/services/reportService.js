import { WellnessRecord } from '../models/WellnessRecord.js';
import { addDays, computeAnalytics, daysBetween, MAX_RANGE_DAYS } from './analyticsService.js';
import { openRecord } from './wellnessRecordService.js';

export function resolveRange({ from, to }) {
  const end = to ?? new Date().toISOString().slice(0, 10);
  const start = from ?? addDays(end, -29);
  return { from: start, to: end };
}

export function rangeIsValid({ from, to }) {
  return from <= to && daysBetween(from, to) <= MAX_RANGE_DAYS;
}

// Loads and decrypts one patient's records in a range. Records failing integrity
// checks are excluded from statistics and counted separately.
export async function loadReadableRecords(patientId, { from, to }) {
  const docs = await WellnessRecord.find({
    patient: patientId,
    isDeleted: false,
    entryDate: { $gte: from, $lte: to },
  }).sort({ entryDate: 1 });
  const readable = [];
  let excluded = 0;
  for (const doc of docs) {
    const opened = openRecord(doc);
    if (opened.status === 'ok') readable.push({ entryDate: doc.entryDate, ...opened.data, doc });
    else excluded += 1;
  }
  return { readable, excluded, docs };
}

export async function analyticsFor(patientId, range, { audience = 'patient' } = {}) {
  const { readable, excluded } = await loadReadableRecords(patientId, range);
  return computeAnalytics(readable, { ...range, excluded, audience });
}

// CSV with formula-injection protection: cells starting with = + - @ (or tab/CR)
// are prefixed with an apostrophe so spreadsheet apps treat them as text.
export function toCsv(rows, columns) {
  const cell = (v) => {
    let s = v == null ? '' : Array.isArray(v) ? v.join(';') : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n');
}
