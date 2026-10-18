import { useCallback, useState } from 'react';
import { describeChainError } from '../services/contract.js';

// Tracks a MetaMask transaction through its real lifecycle:
//   idle → signing (waiting for user approval) → pending (broadcast, has hash)
//        → confirmed (mined with status 1) | failed
// "confirmed" is only set after the receipt reports success.
export function useTransaction() {
  const [state, setState] = useState({ status: 'idle', txHash: null, error: null });

  const run = useCallback(async (send) => {
    setState({ status: 'signing', txHash: null, error: null });
    try {
      const tx = await send();
      setState({ status: 'pending', txHash: tx.hash, error: null });
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error('The transaction failed on-chain.');
      setState({ status: 'confirmed', txHash: tx.hash, error: null });
      return receipt;
    } catch (err) {
      const message = describeChainError(err);
      setState((s) => ({ status: 'failed', txHash: s.txHash, error: message }));
      throw new Error(message);
    }
  }, []);

  const reset = useCallback(() => setState({ status: 'idle', txHash: null, error: null }), []);
  return { ...state, run, reset, busy: state.status === 'signing' || state.status === 'pending' };
}
