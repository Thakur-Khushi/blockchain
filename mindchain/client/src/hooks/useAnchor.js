import { useCallback } from 'react';
import { useWallet } from '../context/WalletContext.jsx';
import { api } from '../services/api.js';
import { useTransaction } from './useTransaction.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Anchors the current version of a record: the patient signs registerRecord /
// updateRecord in MetaMask, then the server checks the mined transaction and the
// contract state before marking the record anchored.
export function useAnchor() {
  const wallet = useWallet();
  const tx = useTransaction();

  const ensureReady = useCallback(async () => {
    if (!wallet.linkedAddress) throw new Error('Link your wallet on the Wallet page first.');
    const contract = await wallet.getContract();
    const signer = contract.runner;
    const address = (await signer.getAddress()).toLowerCase();
    if (address !== wallet.linkedAddress) {
      throw new Error('MetaMask is using a different account from your linked wallet. Switch accounts in MetaMask.');
    }
    // First-time users must register their wallet on the contract.
    if (!(await contract.isRegisteredPatient(address))) {
      await tx.run(() => contract.registerPatient());
    }
    return contract;
  }, [wallet, tx]);

  const anchor = useCallback(
    async (record) => {
      const contract = await ensureReady();
      const receipt = await tx.run(() =>
        record.onChainAction === 'update'
          ? contract.updateRecord(record.recordId, record.digest)
          : contract.registerRecord(record.recordId, record.digest),
      );
      // The server reads the receipt from its own RPC connection; retry briefly in
      // case it has not seen the block yet.
      let lastErr;
      for (let i = 0; i < 4; i += 1) {
        try {
          const { data } = await api.post(`/wellness/${record.recordId}/anchor`, { txHash: receipt.hash });
          return data.record;
        } catch (err) {
          lastErr = err;
          if (err?.response?.data?.error?.code !== 'TX_NOT_FOUND') break;
          await sleep(1000);
        }
      }
      throw lastErr;
    },
    [ensureReady, tx],
  );

  // For a record whose transaction was mined but never confirmed with the server.
  const sync = useCallback(async (record) => {
    const { data } = await api.post(`/wellness/${record.recordId}/anchor`, {});
    return data.record;
  }, []);

  const revoke = useCallback(
    async (record) => {
      const contract = await ensureReady();
      const receipt = await tx.run(() => contract.revokeRecord(record.recordId));
      await api.post(`/wellness/${record.recordId}/revocation`, { txHash: receipt.hash });
    },
    [ensureReady, tx],
  );

  return { anchor, sync, revoke, ensureReady, tx };
}
