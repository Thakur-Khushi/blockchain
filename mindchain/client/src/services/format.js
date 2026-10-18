// Display helpers. Scores are self-reported and descriptive, not clinical measures.

export const MOOD_LABELS = {
  1: 'Very low', 2: 'Low', 3: 'Down', 4: 'Meh', 5: 'Okay',
  6: 'Fine', 7: 'Good', 8: 'Very good', 9: 'Great', 10: 'Excellent',
};
export const MOOD_EMOJI = { 1: '😞', 2: '😟', 3: '🙁', 4: '😕', 5: '😐', 6: '🙂', 7: '😊', 8: '😄', 9: '😁', 10: '🤩' };

export const STRESS_LABELS = {
  1: 'Very relaxed', 2: 'Relaxed', 3: 'Calm', 4: 'Mild', 5: 'Moderate',
  6: 'Noticeable', 7: 'High', 8: 'Very high', 9: 'Severe', 10: 'Overwhelming',
};

export function moodColor(score) {
  if (score == null) return 'bg-slate-200 text-slate-600';
  if (score <= 3) return 'bg-rose-100 text-rose-800';
  if (score <= 5) return 'bg-amber-100 text-amber-800';
  if (score <= 7) return 'bg-sky-100 text-sky-800';
  return 'bg-emerald-100 text-emerald-800';
}

export function stressColor(score) {
  if (score == null) return 'bg-slate-200 text-slate-600';
  if (score <= 3) return 'bg-emerald-100 text-emerald-800';
  if (score <= 6) return 'bg-amber-100 text-amber-800';
  return 'bg-rose-100 text-rose-800';
}

// Local calendar date as YYYY-MM-DD (not UTC), so "today" matches the user's day.
export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

export function formatEntryDate(dateStr, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function average(values) {
  const nums = values.filter((v) => typeof v === 'number');
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

export const AUDIT_LABELS = {
  user_registered: 'Account created',
  login_success: 'Signed in',
  login_failed: 'Failed sign-in',
  logout: 'Signed out',
  therapist_verification_submitted: 'Verification submitted',
  therapist_verified: 'Therapist verified',
  therapist_rejected: 'Therapist rejected',
  account_status_changed: 'Account status changed',
  wallet_linked: 'Wallet linked',
  record_created: 'Check-in created',
  record_anchored: 'Record anchored on-chain',
  record_updated: 'Check-in edited',
  record_deleted: 'Check-in deleted',
  record_revoked_onchain: 'Record withdrawn on-chain',
  record_verified: 'Record verified',
  records_exported: 'Records exported',
  record_access: 'Records viewed by therapist',
  access_denied: 'Access denied',
  consent_granted: 'Access granted',
  consent_revoked: 'Access revoked',
  appointment_created: 'Appointment requested',
  appointment_updated: 'Appointment updated',
};
