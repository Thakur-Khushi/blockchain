import crypto from 'node:crypto';
import { ChainUnavailableError } from '../../src/services/chainService.js';

// In-memory stand-in for the read-only chain service, mirroring MindChain.sol
// semantics. Tests drive state directly (as if the patient had sent transactions)
// and can simulate outages with `fake.down = true`.
export function createFakeChain({ chainId = 31337 } = {}) {
  const contractAddress = '0x' + 'c'.repeat(40);
  const patients = new Set();
  const grants = new Map(); // `${patient}|${therapist}` -> { active, grantedAt, expiresAt }
  const records = new Map(); // recordId -> record
  const txs = new Map(); // txHash -> receipt summary
  const consentLog = []; // AccessGranted / AccessRevoked events
  const recordLog = []; // RecordRegistered / RecordUpdated / RecordRevoked events
  let block = 1;

  const lc = (a) => a.toLowerCase();
  const now = () => Math.floor(Date.now() / 1000);
  const newHash = () => '0x' + crypto.randomBytes(32).toString('hex');

  function mine({ from, success = true, to = contractAddress, events = [] }) {
    const hash = newHash();
    block += 1;
    txs.set(hash, { hash, from: lc(from), to: lc(to), success, blockNumber: block, toContract: lc(to) === contractAddress, events });
    return hash;
  }

  const fake = {
    enabled: true,
    chainId,
    contractAddress,
    down: false,
    calls: { hasAccess: 0 },

    guard() {
      if (fake.down) throw new ChainUnavailableError('Simulated RPC outage');
    },

    // ---- test controls (each mimics a mined, patient-signed transaction) ----
    registerPatient(wallet) {
      patients.add(lc(wallet));
      return mine({ from: wallet });
    },
    grant(patient, therapist, expiresAt = 0) {
      grants.set(`${lc(patient)}|${lc(therapist)}`, { active: true, grantedAt: now(), expiresAt });
      const args = { patient, therapist, expiresAt: BigInt(expiresAt) };
      const hash = mine({ from: patient, events: [{ name: 'AccessGranted', args }] });
      consentLog.push({ type: 'granted', patient: lc(patient), therapist: lc(therapist), expiresAt, txHash: hash, blockNumber: block, logIndex: 0 });
      return hash;
    },
    revoke(patient, therapist) {
      const g = grants.get(`${lc(patient)}|${lc(therapist)}`);
      if (g) g.active = false;
      const hash = mine({ from: patient, events: [{ name: 'AccessRevoked', args: { patient, therapist } }] });
      consentLog.push({ type: 'revoked', patient: lc(patient), therapist: lc(therapist), expiresAt: null, txHash: hash, blockNumber: block, logIndex: 0 });
      return hash;
    },
    // registerRecord / updateRecord: returns the tx hash.
    anchor(recordId, owner, digest) {
      const id = lc(recordId);
      const existing = records.get(id);
      const version = existing ? existing.version + 1 : 1;
      const name = existing ? 'RecordUpdated' : 'RecordRegistered';
      records.set(id, { owner: lc(owner), digest: lc(digest), revoked: false, version, createdAt: existing?.createdAt ?? now(), updatedAt: now() });
      const hash = mine({ from: owner, events: [{ name, args: { recordId: id, owner, digest: lc(digest), version: BigInt(version) } }] });
      recordLog.push({ recordId: id, name, owner: lc(owner), digest: lc(digest), txHash: hash, blockNumber: block, logIndex: 0 });
      return hash;
    },
    revokeRecord(recordId, owner) {
      const id = lc(recordId);
      records.get(id).revoked = true;
      const hash = mine({ from: owner, events: [{ name: 'RecordRevoked', args: { recordId: id, owner } }] });
      recordLog.push({ recordId: id, name: 'RecordRevoked', owner: lc(owner), digest: null, txHash: hash, blockNumber: block, logIndex: 0 });
      return hash;
    },
    // Directly overwrite on-chain state (e.g. to simulate a foreign owner).
    setRecord(recordId, { owner, digest, revoked = false, version = 1 }) {
      records.set(lc(recordId), { owner: lc(owner), digest: lc(digest), revoked, version, createdAt: now(), updatedAt: now() });
    },
    addTx(opts) {
      return mine(opts);
    },

    // ---- chain service interface ----
    async status() {
      if (fake.down) return { available: false, chainId, contractAddress, reason: 'RPC node unreachable' };
      return { available: true, chainId, contractAddress, blockNumber: block };
    },
    async isRegisteredPatient(wallet) {
      fake.guard();
      return patients.has(lc(wallet));
    },
    async hasAccess(patient, therapist) {
      fake.guard();
      fake.calls.hasAccess += 1;
      const g = grants.get(`${lc(patient)}|${lc(therapist)}`);
      return Boolean(g?.active && (g.expiresAt === 0 || now() < g.expiresAt));
    },
    async getGrant(patient, therapist) {
      fake.guard();
      const g = grants.get(`${lc(patient)}|${lc(therapist)}`) ?? { active: false, grantedAt: 0, expiresAt: 0 };
      return { ...g, currentlyValid: await fake.hasAccess(patient, therapist) };
    },
    async getRecord(recordId) {
      fake.guard();
      return records.get(lc(recordId)) ?? null;
    },
    async verifyRecord(recordId, digest) {
      fake.guard();
      const r = records.get(lc(recordId));
      return Boolean(r && !r.revoked && r.digest === lc(digest));
    },
    async getContractTransaction(txHash) {
      fake.guard();
      return txs.get(lc(txHash)) ?? null;
    },
    async getConsentEvents({ patient = null, therapist = null } = {}) {
      fake.guard();
      return consentLog.filter((e) => (!patient || e.patient === lc(patient)) && (!therapist || e.therapist === lc(therapist)));
    },
    async getRecordEvents(recordId) {
      fake.guard();
      return recordLog.filter((e) => e.recordId === lc(recordId));
    },
  };
  return fake;
}
