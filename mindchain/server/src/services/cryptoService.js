import crypto from 'node:crypto';
import { config } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit IV, the size recommended for GCM
const TAG_BYTES = 16;

// Thrown when ciphertext cannot be authenticated (tampering, wrong key, wrong context).
export class IntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IntegrityError';
  }
}

function parseKey(hex, label) {
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error(`${label} must be 32 bytes`);
  return key;
}

// keyring: { currentVersion, keys: Map<version, Buffer> }
export function buildKeyring({ currentKeyHex, currentVersion, previousKeys = '' }) {
  const keys = new Map();
  for (const pair of previousKeys.split(',').filter(Boolean)) {
    const [v, hex] = pair.split(':');
    keys.set(Number(v), parseKey(hex, `Encryption key version ${v}`));
  }
  keys.set(currentVersion, parseKey(currentKeyHex, 'ENCRYPTION_KEY'));
  return { currentVersion, keys };
}

// The AAD binds the ciphertext to its record and owner: moving a ciphertext to
// another record or patient makes authentication fail.
export function buildAad({ recordId, patientId, keyVersion }) {
  return Buffer.from(`mindchain:v1|${recordId}|${patientId}|${keyVersion}`, 'utf8');
}

export function createCipherSuite(keyring) {
  function encryptJson(value, context) {
    const keyVersion = keyring.currentVersion;
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, keyring.keys.get(keyVersion), iv, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(buildAad({ ...context, keyVersion }));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion,
    };
  }

  function decryptJson({ ciphertext, iv, authTag, keyVersion }, context) {
    const key = keyring.keys.get(keyVersion);
    if (!key) throw new IntegrityError(`No decryption key available for key version ${keyVersion}`);
    try {
      const ivBuf = Buffer.from(iv, 'base64');
      const tagBuf = Buffer.from(authTag, 'base64');
      if (ivBuf.length !== IV_BYTES || tagBuf.length !== TAG_BYTES) {
        throw new Error('bad iv/tag length');
      }
      const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuf, { authTagLength: TAG_BYTES });
      decipher.setAAD(buildAad({ ...context, keyVersion }));
      decipher.setAuthTag(tagBuf);
      const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
      return JSON.parse(plaintext.toString('utf8'));
    } catch {
      // Do not leak which part failed; the caller reports "tampered".
      throw new IntegrityError('Encrypted record failed authentication');
    }
  }

  return { encryptJson, decryptJson, currentKeyVersion: keyring.currentVersion };
}

export const cipherSuite = createCipherSuite(
  buildKeyring({
    currentKeyHex: config.ENCRYPTION_KEY,
    currentVersion: config.ENCRYPTION_KEY_VERSION,
    previousKeys: config.ENCRYPTION_PREVIOUS_KEYS ?? '',
  }),
);
