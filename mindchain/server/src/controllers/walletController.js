import crypto from 'node:crypto';
import { getAddress, isAddress, verifyMessage } from 'ethers';
import { z } from 'zod';
import { config } from '../config/env.js';
import { User } from '../models/User.js';
import { WalletNonce } from '../models/WalletNonce.js';
import { WellnessRecord } from '../models/WellnessRecord.js';
import { recordAudit } from '../services/auditService.js';
import { ChainUnavailableError } from '../services/chainService.js';
import { badRequest, conflict, unauthorized } from '../utils/AppError.js';

const DEFAULT_CHAIN_ID = 31337;

const address = z
  .string()
  .trim()
  .refine((v) => isAddress(v), 'Invalid Ethereum address')
  .transform((v) => v.toLowerCase());

export const nonceBody = z.object({ address });

export const verifyBody = z.object({
  address,
  nonce: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid nonce'),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, 'Invalid signature'),
});

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Human-readable message shown in MetaMask. It names the account, wallet, chain,
// nonce and time, so a signature cannot be replayed for another account or later.
export function buildWalletMessage({ userId, address: addr, chainId, nonce, issuedAt }) {
  return [
    'MindChain wallet verification',
    '',
    'Sign this message to prove you own this wallet and link it to your MindChain account.',
    'This does not send a transaction or cost any gas.',
    '',
    `Account: ${userId}`,
    `Wallet: ${getAddress(addr)}`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
  ].join('\n');
}

function chainIdFor(req) {
  return req.app.locals.chain?.chainId ?? config.CHAIN_ID ?? DEFAULT_CHAIN_ID;
}

async function assertAddressAvailable(addr, userId) {
  const owner = await User.findOne({ walletAddress: addr }).select('_id');
  if (owner && !owner._id.equals(userId)) throw conflict('This wallet is already linked to another account');
}

// Changing wallet after records are anchored would orphan the on-chain ownership proof.
async function assertCanChangeWallet(user, addr) {
  if (!user.walletAddress || user.walletAddress === addr) return;
  if (user.role === 'patient') {
    const anchored = await WellnessRecord.exists({ patient: user._id, chainStatus: 'anchored' });
    if (anchored) {
      throw conflict('Your records are anchored to your current wallet, so it cannot be replaced');
    }
  }
}

export async function requestNonce(req, res) {
  const addr = req.valid.body.address;
  await assertAddressAvailable(addr, req.user._id);
  await assertCanChangeWallet(req.user, addr);

  const nonce = crypto.randomBytes(32).toString('hex');
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + config.WALLET_NONCE_TTL_SECONDS * 1000);
  const chainId = chainIdFor(req);

  // One outstanding challenge per user; requesting a new one replaces the old one.
  await WalletNonce.findOneAndUpdate(
    { user: req.user._id },
    { $set: { address: addr, nonceHash: sha256(nonce), chainId, issuedAt, expiresAt } },
    { upsert: true },
  );

  const message = buildWalletMessage({ userId: req.user._id.toString(), address: addr, chainId, nonce, issuedAt });
  res.status(201).json({ message, nonce, expiresAt });
}

export async function verifyWallet(req, res) {
  const { address: addr, nonce, signature } = req.valid.body;

  // Consume the challenge first: whatever happens next, it can never be reused.
  const challenge = await WalletNonce.findOneAndDelete({ user: req.user._id });
  if (!challenge || challenge.expiresAt.getTime() <= Date.now()) {
    throw badRequest('Verification request expired or not found. Please try again.');
  }
  const hashOk = crypto.timingSafeEqual(Buffer.from(sha256(nonce)), Buffer.from(challenge.nonceHash));
  if (!hashOk || challenge.address !== addr) {
    throw badRequest('Verification request does not match. Please try again.');
  }

  const message = buildWalletMessage({
    userId: req.user._id.toString(),
    address: addr,
    chainId: challenge.chainId,
    nonce,
    issuedAt: challenge.issuedAt,
  });
  let recovered;
  try {
    recovered = verifyMessage(message, signature).toLowerCase();
  } catch {
    recovered = null;
  }
  if (recovered !== addr) {
    await recordAudit({ eventType: 'wallet_linked', actor: req.user._id, outcome: 'denied', detail: 'bad_signature' });
    throw unauthorized('Signature does not match the wallet address');
  }

  await assertAddressAvailable(addr, req.user._id);
  await assertCanChangeWallet(req.user, addr);
  req.user.walletAddress = addr;
  await req.user.save();

  await recordAudit({ eventType: 'wallet_linked', actor: req.user._id });
  res.json({ user: req.user });
}

export async function walletStatus(req, res) {
  const chain = req.app.locals.chain;
  const status = await chain.status();
  let registeredPatient = null;
  if (req.user.role === 'patient' && req.user.walletAddress && status.available) {
    try {
      registeredPatient = await chain.isRegisteredPatient(req.user.walletAddress);
    } catch (err) {
      if (!(err instanceof ChainUnavailableError)) throw err;
    }
  }
  res.json({ walletAddress: req.user.walletAddress ?? null, registeredPatient, chain: status });
}

export async function chainStatus(req, res) {
  res.json({ chain: await req.app.locals.chain.status() });
}
