// Runs the real read-only chain service against a real Hardhat node and the
// compiled MindChain contract. Skipped if the blockchain workspace is not built.
import './helpers/setup.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractFactory, JsonRpcProvider, hexlify, randomBytes, sha256, toUtf8Bytes } from 'ethers';
import { ChainUnavailableError, createChainService } from '../src/services/chainService.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const blockchainDir = path.resolve(here, '..', '..', 'blockchain');
const hardhatCli = path.join(blockchainDir, 'node_modules', 'hardhat', 'dist', 'src', 'cli.js');
const artifactPath = path.join(blockchainDir, 'artifacts', 'contracts', 'MindChain.sol', 'MindChain.json');
const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;

const available = fs.existsSync(hardhatCli) && fs.existsSync(artifactPath);

async function waitForRpc(url, ms = 60000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Hardhat node did not start');
}

describe('chainService against a real Hardhat node', { skip: !available && 'blockchain workspace not built' }, () => {
  let node;
  let provider;
  let contract;
  let service;
  let patient;
  let therapist;
  let abi;

  before(async () => {
    node = spawn(process.execPath, [hardhatCli, 'node', '--port', String(PORT)], {
      cwd: blockchainDir,
      stdio: 'ignore',
    });
    await waitForRpc(RPC);
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    abi = artifact.abi;
    // Hardhat node accounts are unlocked; no private keys are needed here.
    provider = new JsonRpcProvider(RPC, 31337, { staticNetwork: true });
    const deployer = await provider.getSigner(0);
    patient = await provider.getSigner(1);
    therapist = await provider.getSigner(2);
    contract = await new ContractFactory(abi, artifact.bytecode, deployer).deploy();
    await contract.waitForDeployment();
    service = createChainService({ rpcUrl: RPC, chainId: 31337, contractAddress: await contract.getAddress(), abi, timeoutMs: 3000 });
  });

  after(() => {
    provider?.destroy();
    node?.kill();
  });

  it('reports status as available', async () => {
    const s = await service.status();
    assert.equal(s.available, true);
    assert.equal(s.chainId, 31337);
  });

  it('reads patient registration and consent grants/revocations', async () => {
    const c = contract.connect(patient);
    assert.equal(await service.isRegisteredPatient(patient.address), false);
    await (await c.registerPatient()).wait();
    assert.equal(await service.isRegisteredPatient(patient.address), true);

    assert.equal(await service.hasAccess(patient.address, therapist.address), false);
    await (await c.grantAccess(therapist.address, 0)).wait();
    assert.equal(await service.hasAccess(patient.address, therapist.address), true);
    const g = await service.getGrant(patient.address, therapist.address);
    assert.equal(g.currentlyValid, true);

    await (await c.revokeAccess(therapist.address)).wait();
    assert.equal(await service.hasAccess(patient.address, therapist.address), false);
  });

  it('reads records, verifies digests and decodes transaction events', async () => {
    const recordId = hexlify(randomBytes(32));
    const digest = sha256(toUtf8Bytes('record'));
    const tx = await contract.connect(patient).registerRecord(recordId, digest);
    await tx.wait();

    const r = await service.getRecord(recordId);
    assert.equal(r.owner, patient.address.toLowerCase());
    assert.equal(r.digest, digest.toLowerCase());
    assert.equal(r.version, 1);
    assert.equal(await service.verifyRecord(recordId, digest), true);
    assert.equal(await service.verifyRecord(recordId, sha256(toUtf8Bytes('other'))), false);
    assert.equal(await service.getRecord(hexlify(randomBytes(32))), null);

    const info = await service.getContractTransaction(tx.hash);
    assert.equal(info.success, true);
    assert.equal(info.toContract, true);
    assert.equal(info.from, patient.address.toLowerCase());
    const ev = info.events.find((e) => e.name === 'RecordRegistered');
    assert.equal(ev.args.recordId, recordId);
    assert.equal(ev.args.digest, digest);
    assert.equal(await service.getContractTransaction('0x' + 'ab'.repeat(32)), null);
  });

  it('reads consent and record history from contract events', async () => {
    const consent = await service.getConsentEvents({ patient: patient.address });
    assert.deepEqual(consent.map((e) => e.type), ['granted', 'revoked']);
    assert.equal(consent[0].therapist, therapist.address.toLowerCase());
    assert.match(consent[0].txHash, /^0x[0-9a-f]{64}$/);
    const byTherapist = await service.getConsentEvents({ therapist: therapist.address });
    assert.equal(byTherapist.length, 2);

    const recordId = hexlify(randomBytes(32));
    const d1 = sha256(toUtf8Bytes('v1'));
    const d2 = sha256(toUtf8Bytes('v2'));
    const c = contract.connect(patient);
    await (await c.registerRecord(recordId, d1)).wait();
    await (await c.updateRecord(recordId, d2)).wait();
    await (await c.revokeRecord(recordId)).wait();
    const history = await service.getRecordEvents(recordId);
    assert.deepEqual(history.map((e) => e.name), ['RecordRegistered', 'RecordUpdated', 'RecordRevoked']);
    assert.equal(history[1].digest, d2.toLowerCase());
    assert.equal((await service.getRecord(recordId)).revoked, true);
  });

  it('fails closed when the configured address has no contract', async () => {
    const wrong = createChainService({ rpcUrl: RPC, chainId: 31337, contractAddress: '0x' + '1'.repeat(40), abi, timeoutMs: 3000 });
    assert.equal((await wrong.status()).available, false);
    await assert.rejects(wrong.hasAccess(patient.address, therapist.address), ChainUnavailableError);
  });

  it('reports a chain id mismatch as unavailable', async () => {
    const wrongChain = createChainService({ rpcUrl: RPC, chainId: 1, contractAddress: await contract.getAddress(), abi, timeoutMs: 3000 });
    const s = await wrongChain.status();
    assert.equal(s.available, false);
    assert.match(s.reason, /chain 31337/);
  });

  it('fails closed when the RPC node is unreachable', async () => {
    const offline = createChainService({ rpcUrl: 'http://127.0.0.1:1', chainId: 31337, contractAddress: await contract.getAddress(), abi, timeoutMs: 1000 });
    assert.equal((await offline.status()).available, false);
    await assert.rejects(offline.hasAccess(patient.address, therapist.address), ChainUnavailableError);
  });
});
