import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import request from 'supertest';
import { bearer, clearDb, createUser, startDb, stopDb } from './helpers/db.js';
import { createFakeChain } from './helpers/fakeChain.js';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { WalletNonce } from '../src/models/WalletNonce.js';
import { WellnessRecord } from '../src/models/WellnessRecord.js';

const chain = createFakeChain();
const app = createApp({ chain });

async function challenge(token, address) {
  const res = await request(app).post('/api/wallet/nonce').set(bearer(token)).send({ address }).expect(201);
  return res.body;
}

async function linkWallet(token, wallet) {
  const { message, nonce } = await challenge(token, wallet.address);
  const signature = await wallet.signMessage(message);
  return request(app).post('/api/wallet/verify').set(bearer(token)).send({ address: wallet.address, nonce, signature });
}

describe('Wallet linking (signed nonce)', () => {
  before(startDb);
  after(stopDb);
  beforeEach(async () => {
    await clearDb();
    chain.down = false;
  });

  it('issues a human-readable challenge bound to account, wallet, chain and nonce', async () => {
    const { user, token } = await createUser();
    const wallet = Wallet.createRandom();
    const { message, nonce, expiresAt } = await challenge(token, wallet.address.toLowerCase());
    assert.match(nonce, /^[a-f0-9]{64}$/);
    assert.ok(message.includes(`Account: ${user._id}`));
    assert.ok(message.includes(`Wallet: ${wallet.address}`)); // checksummed
    assert.ok(message.includes('Chain ID: 31337'));
    assert.ok(message.includes(`Nonce: ${nonce}`));
    assert.ok(new Date(expiresAt) > new Date());
    const stored = await WalletNonce.findOne({ user: user._id }).lean();
    assert.notEqual(stored.nonceHash, nonce, 'nonce must be stored hashed');
  });

  it('links a wallet when the signature is valid', async () => {
    const { user, token } = await createUser();
    const wallet = Wallet.createRandom();
    const res = await linkWallet(token, wallet);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.walletAddress, wallet.address.toLowerCase());
    assert.equal((await User.findById(user._id)).walletAddress, wallet.address.toLowerCase());
    assert.equal(await WalletNonce.countDocuments(), 0);
  });

  it('rejects a replayed signature (nonce is single-use)', async () => {
    const { token } = await createUser();
    const wallet = Wallet.createRandom();
    const { message, nonce } = await challenge(token, wallet.address);
    const signature = await wallet.signMessage(message);
    const body = { address: wallet.address, nonce, signature };
    await request(app).post('/api/wallet/verify').set(bearer(token)).send(body).expect(200);
    await request(app).post('/api/wallet/verify').set(bearer(token)).send(body).expect(400);
  });

  it('rejects a signature from a different wallet and burns the nonce', async () => {
    const { token } = await createUser();
    const claimed = Wallet.createRandom();
    const attacker = Wallet.createRandom();
    const { message, nonce } = await challenge(token, claimed.address);
    const signature = await attacker.signMessage(message);
    await request(app)
      .post('/api/wallet/verify')
      .set(bearer(token))
      .send({ address: claimed.address, nonce, signature })
      .expect(401);
    // The challenge is gone even though verification failed.
    const sig2 = await claimed.signMessage(message);
    await request(app)
      .post('/api/wallet/verify')
      .set(bearer(token))
      .send({ address: claimed.address, nonce, signature: sig2 })
      .expect(400);
  });

  it('rejects a signature over a different message (e.g. other account)', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const wallet = Wallet.createRandom();
    const a = await challenge(alice.token, wallet.address);
    const b = await challenge(bob.token, wallet.address);
    // Bob tries to use the signature Alice's wallet produced for Alice's challenge.
    const aliceSig = await wallet.signMessage(a.message);
    await request(app)
      .post('/api/wallet/verify')
      .set(bearer(bob.token))
      .send({ address: wallet.address, nonce: b.nonce, signature: aliceSig })
      .expect(401);
  });

  it('cannot use another user\'s nonce', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const wallet = Wallet.createRandom();
    const { message, nonce } = await challenge(alice.token, wallet.address);
    const signature = await wallet.signMessage(message);
    await request(app)
      .post('/api/wallet/verify')
      .set(bearer(bob.token))
      .send({ address: wallet.address, nonce, signature })
      .expect(400);
  });

  it('rejects expired challenges', async () => {
    const { user, token } = await createUser();
    const wallet = Wallet.createRandom();
    const { message, nonce } = await challenge(token, wallet.address);
    await WalletNonce.updateOne({ user: user._id }, { expiresAt: new Date(Date.now() - 1000) });
    const signature = await wallet.signMessage(message);
    await request(app)
      .post('/api/wallet/verify')
      .set(bearer(token))
      .send({ address: wallet.address, nonce, signature })
      .expect(400);
  });

  it('rejects an address that differs from the challenged one', async () => {
    const { token } = await createUser();
    const w1 = Wallet.createRandom();
    const w2 = Wallet.createRandom();
    const { message, nonce } = await challenge(token, w1.address);
    const signature = await w2.signMessage(message);
    await request(app)
      .post('/api/wallet/verify')
      .set(bearer(token))
      .send({ address: w2.address, nonce, signature })
      .expect(400);
  });

  it('prevents linking a wallet that belongs to another account', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const wallet = Wallet.createRandom();
    assert.equal((await linkWallet(alice.token, wallet)).status, 200);
    await request(app).post('/api/wallet/nonce').set(bearer(bob.token)).send({ address: wallet.address }).expect(409);
  });

  it('prevents a patient replacing a wallet once records are anchored', async () => {
    const { user, token } = await createUser();
    assert.equal((await linkWallet(token, Wallet.createRandom())).status, 200);
    await WellnessRecord.create({
      patient: user._id,
      recordId: '0x' + '1'.repeat(64),
      entryDate: '2026-10-01',
      encryptedPayload: 'x',
      iv: 'x',
      authTag: 'x',
      keyVersion: 1,
      digest: '0x' + '2'.repeat(64),
      chainStatus: 'anchored',
    });
    await request(app)
      .post('/api/wallet/nonce')
      .set(bearer(token))
      .send({ address: Wallet.createRandom().address })
      .expect(409);
  });

  it('validates inputs', async () => {
    const { token } = await createUser();
    await request(app).post('/api/wallet/nonce').set(bearer(token)).send({ address: '0x123' }).expect(400);
    await request(app)
      .post('/api/wallet/verify')
      .set(bearer(token))
      .send({ address: Wallet.createRandom().address, nonce: 'abc', signature: '0x00' })
      .expect(400);
    await request(app).post('/api/wallet/nonce').send({ address: Wallet.createRandom().address }).expect(401);
  });

  it('reports wallet and on-chain registration status', async () => {
    const { token } = await createUser();
    const wallet = Wallet.createRandom();
    await linkWallet(token, wallet);
    let res = await request(app).get('/api/wallet').set(bearer(token)).expect(200);
    assert.equal(res.body.registeredPatient, false);
    assert.equal(res.body.chain.available, true);

    chain.registerPatient(wallet.address);
    res = await request(app).get('/api/wallet').set(bearer(token)).expect(200);
    assert.equal(res.body.registeredPatient, true);

    chain.down = true;
    res = await request(app).get('/api/wallet').set(bearer(token)).expect(200);
    assert.equal(res.body.chain.available, false);
    assert.equal(res.body.registeredPatient, null);
  });
});

describe('Chain status without a deployment', () => {
  before(startDb);
  after(stopDb);

  it('reports the chain as unavailable (fail closed)', async () => {
    const plainApp = createApp(); // DEPLOYMENT_FILE points to a missing file in tests
    const { token } = await createUser();
    const res = await request(plainApp).get('/api/chain/status').set(bearer(token)).expect(200);
    assert.equal(res.body.chain.available, false);
    assert.match(res.body.chain.reason, /not deployed/);
  });
});
