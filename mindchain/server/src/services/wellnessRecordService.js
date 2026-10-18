import { cipherSuite, IntegrityError } from './cryptoService.js';
import { computeDigest, DIGEST_VERSION, digestsEqual, newSalt } from './recordDigest.js';

// Encrypts the sensitive fields and computes the integrity digest for a record.
export function sealRecord({ recordId, patientId, entryDate, mood, stress, journal, tags }, suite = cipherSuite) {
  const salt = newSalt();
  const patient = String(patientId);
  const digest = computeDigest({ recordId, patientId: patient, entryDate, mood, stress, journal, tags, salt });
  const enc = suite.encryptJson({ mood, stress, journal, tags, salt }, { recordId, patientId: patient });
  return {
    encryptedPayload: enc.ciphertext,
    iv: enc.iv,
    authTag: enc.authTag,
    keyVersion: enc.keyVersion,
    digest,
    digestVersion: DIGEST_VERSION,
  };
}

// Decrypts a stored record and re-checks its digest locally (no blockchain).
// Returns { status: 'ok', data } or { status: 'tampered', reason } — never throws on bad data.
export function openRecord(doc, suite = cipherSuite) {
  if (doc.isDeleted) return { status: 'deleted' };
  const context = { recordId: doc.recordId, patientId: doc.patient.toString() };

  let payload;
  try {
    payload = suite.decryptJson(
      { ciphertext: doc.encryptedPayload, iv: doc.iv, authTag: doc.authTag, keyVersion: doc.keyVersion },
      context,
    );
  } catch (err) {
    if (err instanceof IntegrityError) return { status: 'tampered', reason: 'decryption_failed' };
    throw err;
  }

  const recomputed = computeDigest({
    recordId: doc.recordId,
    patientId: context.patientId,
    entryDate: doc.entryDate,
    mood: payload.mood,
    stress: payload.stress,
    journal: payload.journal,
    tags: payload.tags,
    salt: payload.salt,
  });
  if (!digestsEqual(recomputed, doc.digest)) {
    return { status: 'tampered', reason: 'digest_mismatch', recomputedDigest: recomputed };
  }

  const { salt: _salt, ...data } = payload;
  return { status: 'ok', data, recomputedDigest: recomputed };
}

// Client-facing representation. Content is only included when integrity checks pass.
export function serializeRecord(doc, opened = openRecord(doc)) {
  const base = {
    id: doc.recordId,
    recordId: doc.recordId,
    entryDate: doc.entryDate,
    digest: doc.digest,
    version: doc.version,
    chainStatus: doc.chainStatus,
    txHash: doc.txHash ?? null,
    chainId: doc.chainId ?? null,
    anchoredAt: doc.anchoredAt ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    integrity: { status: opened.status, reason: opened.reason ?? null },
  };
  if (opened.status !== 'ok') return base;
  return { ...base, ...opened.data };
}
