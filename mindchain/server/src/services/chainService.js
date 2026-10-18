import fs from 'node:fs';
import path from 'node:path';
import { Contract, FetchRequest, getAddress, Interface, JsonRpcProvider, Network } from 'ethers';
import { config } from '../config/env.js';

// Raised whenever the chain cannot give a trustworthy answer (node down, wrong
// network, contract missing, timeout). Callers must fail closed on this error.
export class ChainUnavailableError extends Error {
  constructor(message = 'Blockchain network is unavailable') {
    super(message);
    this.name = 'ChainUnavailableError';
  }
}

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

// Read-only client for MindChain.sol. It never signs or sends transactions: all
// state changes are signed by the patient in MetaMask.
export function createChainService({ rpcUrl, chainId, contractAddress, abi, timeoutMs = 5000 }) {
  const request = new FetchRequest(rpcUrl);
  request.timeout = timeoutMs;
  const provider = new JsonRpcProvider(request, Network.from(chainId), { staticNetwork: true, batchMaxCount: 1 });
  const address = getAddress(contractAddress);
  const contract = new Contract(address, abi, provider);
  const iface = new Interface(abi);

  async function call(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ChainUnavailableError) throw err;
      // BAD_DATA means "0x" was returned: no contract at this address on this node.
      const reason = err?.code === 'BAD_DATA' ? 'MindChain contract not found at the configured address' : undefined;
      throw new ChainUnavailableError(reason);
    }
  }

  return {
    enabled: true,
    chainId,
    contractAddress: address,

    async status() {
      try {
        const [network, code, blockNumber] = await Promise.all([
          provider.send('eth_chainId', []),
          provider.getCode(address),
          provider.getBlockNumber(),
        ]);
        if (Number(network) !== chainId) {
          return { available: false, chainId, contractAddress: address, reason: `RPC is on chain ${Number(network)}` };
        }
        if (code === '0x') {
          return { available: false, chainId, contractAddress: address, reason: 'Contract not deployed on this node' };
        }
        return { available: true, chainId, contractAddress: address, blockNumber };
      } catch {
        return { available: false, chainId, contractAddress: address, reason: 'RPC node unreachable' };
      }
    },

    hasAccess: (patient, therapist) => call(() => contract.hasAccess(patient, therapist)),

    isRegisteredPatient: (wallet) => call(() => contract.isRegisteredPatient(wallet)),

    async getGrant(patient, therapist) {
      const g = await call(() => contract.getGrant(patient, therapist));
      return {
        active: g.active,
        grantedAt: Number(g.grantedAt),
        expiresAt: Number(g.expiresAt),
        currentlyValid: g.currentlyValid,
      };
    },

    // Returns null when the record id has never been registered on-chain.
    async getRecord(recordId) {
      if (!BYTES32.test(recordId)) return null;
      const exists = await call(() => contract.recordExists(recordId));
      if (!exists) return null;
      const r = await call(() => contract.getRecord(recordId));
      return {
        owner: r.owner.toLowerCase(),
        digest: r.digest.toLowerCase(),
        createdAt: Number(r.createdAt),
        updatedAt: Number(r.updatedAt),
        version: Number(r.version),
        revoked: r.revoked,
      };
    },

    verifyRecord: (recordId, digest) => call(() => contract.verifyRecord(recordId, digest)),

    // Consent history from indexed AccessGranted / AccessRevoked events. Used only
    // to discover candidate pairs; current access is always re-checked with hasAccess.
    // (A production deployment would use an indexer instead of scanning from block 0.)
    async getConsentEvents({ patient = null, therapist = null } = {}) {
      const [granted, revoked] = await call(() =>
        Promise.all([
          contract.queryFilter(contract.filters.AccessGranted(patient, therapist), 0, 'latest'),
          contract.queryFilter(contract.filters.AccessRevoked(patient, therapist), 0, 'latest'),
        ]),
      );
      return [...granted, ...revoked]
        .map((e) => ({
          type: e.fragment.name === 'AccessGranted' ? 'granted' : 'revoked',
          patient: e.args.patient.toLowerCase(),
          therapist: e.args.therapist.toLowerCase(),
          expiresAt: e.fragment.name === 'AccessGranted' ? Number(e.args.expiresAt) : null,
          txHash: e.transactionHash,
          blockNumber: e.blockNumber,
          logIndex: e.index,
        }))
        .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    },

    // On-chain history of one record (registration, updates, revocation).
    async getRecordEvents(recordId) {
      if (!BYTES32.test(recordId)) return [];
      const logs = await call(() =>
        Promise.all([
          contract.queryFilter(contract.filters.RecordRegistered(recordId), 0, 'latest'),
          contract.queryFilter(contract.filters.RecordUpdated(recordId), 0, 'latest'),
          contract.queryFilter(contract.filters.RecordRevoked(recordId), 0, 'latest'),
        ]),
      );
      return logs
        .flat()
        .map((e) => ({
          name: e.fragment.name,
          owner: e.args.owner.toLowerCase(),
          digest: e.args.digest ? e.args.digest.toLowerCase() : null,
          txHash: e.transactionHash,
          blockNumber: e.blockNumber,
          logIndex: e.index,
        }))
        .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    },

    // Fetches a mined transaction and decodes MindChain events from it.
    // Returns null if the transaction is unknown or not yet mined.
    async getContractTransaction(txHash) {
      if (!BYTES32.test(txHash)) return null;
      const receipt = await call(() => provider.getTransactionReceipt(txHash));
      if (!receipt) return null;
      const events = [];
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== address.toLowerCase()) continue;
        try {
          const parsed = iface.parseLog(log);
          if (parsed) events.push({ name: parsed.name, args: parsed.args });
        } catch {
          /* not a MindChain event */
        }
      }
      return {
        hash: receipt.hash,
        from: receipt.from.toLowerCase(),
        to: receipt.to?.toLowerCase() ?? null,
        success: receipt.status === 1,
        blockNumber: receipt.blockNumber,
        toContract: receipt.to?.toLowerCase() === address.toLowerCase(),
        events,
      };
    },
  };
}

// Used when no deployment is configured: every on-chain operation fails closed.
export function createDisabledChainService(reason = 'MindChain contract is not configured') {
  const fail = async () => {
    throw new ChainUnavailableError(reason);
  };
  return {
    enabled: false,
    chainId: null,
    contractAddress: null,
    status: async () => ({ available: false, chainId: null, contractAddress: null, reason }),
    hasAccess: fail,
    isRegisteredPatient: fail,
    getGrant: fail,
    getRecord: fail,
    verifyRecord: fail,
    getContractTransaction: fail,
    getConsentEvents: fail,
    getRecordEvents: fail,
  };
}

export function loadDeployment(file = config.DEPLOYMENT_FILE) {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) return null;
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

export function createChainServiceFromConfig() {
  const deployment = loadDeployment();
  const contractAddress = config.CONTRACT_ADDRESS || deployment?.address;
  const chainId = config.CHAIN_ID ?? deployment?.chainId;
  if (!deployment?.abi || !contractAddress || !chainId) {
    return createDisabledChainService('MindChain contract is not deployed. Run `npm run deploy:local` in /blockchain.');
  }
  return createChainService({
    rpcUrl: config.RPC_URL,
    chainId,
    contractAddress,
    abi: deployment.abi,
    timeoutMs: config.RPC_TIMEOUT_MS,
  });
}
