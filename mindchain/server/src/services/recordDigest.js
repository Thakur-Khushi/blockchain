import crypto from 'node:crypto';

export const DIGEST_VERSION = 1;

// Canonical representation v1 (documented in docs/IMPLEMENTATION_PLAN.md §4.4):
// compact UTF-8 JSON with this exact key order. Tags are normalised (lower-case,
// de-duplicated, sorted) before they reach here, so the output is deterministic.
// The random salt prevents brute-forcing low-entropy entries from the public hash.
export function canonicalize({ recordId, patientId, entryDate, mood, stress, journal, tags, salt }) {
  return JSON.stringify({
    v: DIGEST_VERSION,
    recordId,
    patientId: String(patientId),
    entryDate,
    mood,
    stress,
    journal,
    tags,
    salt,
  });
}

// Returns a 0x-prefixed SHA-256 digest, the bytes32 format stored on-chain.
export function computeDigest(fields) {
  return '0x' + crypto.createHash('sha256').update(canonicalize(fields), 'utf8').digest('hex');
}

export function newRecordId() {
  return '0x' + crypto.randomBytes(32).toString('hex');
}

export function newSalt() {
  return crypto.randomBytes(32).toString('hex');
}

// Constant-time comparison of two 0x-hex digests.
export function digestsEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a.toLowerCase()), Buffer.from(b.toLowerCase()));
}
