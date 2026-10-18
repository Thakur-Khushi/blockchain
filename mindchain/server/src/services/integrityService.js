import { ChainUnavailableError } from './chainService.js';
import { digestsEqual } from './recordDigest.js';
import { openRecord } from './wellnessRecordService.js';

// Full record verification. Each check is reported separately and the overall
// status is "verified" only when every check passes against the live chain.
//
// checks.decryption: pass | fail                   (AES-GCM authentication)
// checks.digest:     pass | fail | skipped         (recomputed SHA-256 vs stored digest)
// checks.onChain:    pass | missing | mismatch | revoked | unavailable | skipped
// checks.owner:      pass | fail | no_wallet | unavailable | skipped
//
// status: verified | tampered | outdated | not_anchored | revoked | chain_unavailable
export async function verifyRecordIntegrity(doc, { chain, patientWallet }) {
  const checks = { decryption: 'skipped', digest: 'skipped', onChain: 'skipped', owner: 'skipped' };
  const result = (status, reason, onChain = null) => ({ status, reason, checks, onChain });

  const opened = openRecord(doc);
  checks.decryption = opened.status === 'tampered' && opened.reason === 'decryption_failed' ? 'fail' : 'pass';
  if (checks.decryption === 'pass') checks.digest = opened.status === 'ok' ? 'pass' : 'fail';
  const localOk = opened.status === 'ok';

  let onChain;
  try {
    onChain = await chain.getRecord(doc.recordId);
  } catch (err) {
    if (!(err instanceof ChainUnavailableError)) throw err;
    checks.onChain = 'unavailable';
    checks.owner = 'unavailable';
    if (!localOk) return result('tampered', 'Stored record failed local integrity checks');
    return result('chain_unavailable', 'The blockchain could not be reached, so the record cannot be verified');
  }

  if (!onChain) {
    checks.onChain = 'missing';
    if (!localOk) return result('tampered', 'Stored record failed local integrity checks');
    return result('not_anchored', 'This record has not been anchored on-chain yet');
  }

  if (!patientWallet) checks.owner = 'no_wallet';
  else checks.owner = onChain.owner === patientWallet.toLowerCase() ? 'pass' : 'fail';

  if (onChain.revoked) checks.onChain = 'revoked';
  else checks.onChain = digestsEqual(onChain.digest, doc.digest) ? 'pass' : 'mismatch';

  if (!localOk) return result('tampered', 'Stored record failed local integrity checks', onChain);
  if (checks.owner === 'fail') return result('tampered', 'The on-chain record belongs to a different wallet', onChain);
  if (checks.onChain === 'revoked') return result('revoked', 'This record was withdrawn on-chain', onChain);
  if (checks.onChain === 'mismatch') {
    // An edit that has not been re-anchored yet is expected; anything else means
    // the stored record no longer matches what the patient anchored.
    if (doc.chainStatus === 'pending') {
      return result('outdated', 'The record was edited and the new version is not anchored yet', onChain);
    }
    return result('tampered', 'The stored record does not match its on-chain fingerprint', onChain);
  }
  if (checks.owner !== 'pass') return result('tampered', 'The record owner could not be confirmed', onChain);
  return result('verified', 'Decryption, digest, on-chain fingerprint and owner all match', onChain);
}
