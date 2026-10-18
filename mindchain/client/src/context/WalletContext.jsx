import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';
import { describeChainError, EXPECTED_CHAIN_ID, getMindChain, loadEthers, NETWORK_NAME } from '../services/contract.js';
import { useAuth } from './AuthContext.jsx';

const WalletContext = createContext(null);

function getEthereum() {
  return typeof window !== 'undefined' ? window.ethereum : undefined;
}

export function WalletProvider({ children }) {
  const { user, refreshUser } = useAuth();
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);
  const hasProvider = Boolean(getEthereum());

  // Read the current state without prompting the user.
  useEffect(() => {
    const eth = getEthereum();
    if (!eth) return undefined;
    eth.request({ method: 'eth_accounts' }).then((a) => setAccount(a[0]?.toLowerCase() ?? null)).catch(() => {});
    eth.request({ method: 'eth_chainId' }).then((c) => setChainId(Number(c))).catch(() => {});

    const onAccounts = (a) => setAccount(a[0]?.toLowerCase() ?? null);
    const onChain = (c) => setChainId(Number(c));
    eth.on?.('accountsChanged', onAccounts);
    eth.on?.('chainChanged', onChain);
    return () => {
      eth.removeListener?.('accountsChanged', onAccounts);
      eth.removeListener?.('chainChanged', onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    const eth = getEthereum();
    if (!eth) throw new Error('MetaMask was not detected. Install the MetaMask extension to continue.');
    setConnecting(true);
    setError(null);
    try {
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      const acc = accounts[0]?.toLowerCase() ?? null;
      setAccount(acc);
      setChainId(Number(await eth.request({ method: 'eth_chainId' })));
      return acc;
    } catch (err) {
      const msg = describeChainError(err);
      setError(msg);
      throw new Error(msg);
    } finally {
      setConnecting(false);
    }
  }, []);

  const switchNetwork = useCallback(async () => {
    const eth = getEthereum();
    if (!eth) throw new Error('MetaMask was not detected.');
    const hexId = `0x${EXPECTED_CHAIN_ID.toString(16)}`;
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
    } catch (err) {
      // 4902: the chain is not yet known to MetaMask, so add it.
      if (err?.code === 4902 || err?.data?.originalError?.code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: hexId,
              chainName: NETWORK_NAME,
              rpcUrls: [import.meta.env.VITE_RPC_URL || 'http://127.0.0.1:8545'],
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            },
          ],
        });
      } else {
        throw new Error(describeChainError(err));
      }
    }
    setChainId(EXPECTED_CHAIN_ID);
  }, []);

  // Returns a signer on the expected network, connecting/switching as needed.
  const getSigner = useCallback(async () => {
    const eth = getEthereum();
    if (!eth) throw new Error('MetaMask was not detected.');
    if (!account) await connect();
    if (Number(await eth.request({ method: 'eth_chainId' })) !== EXPECTED_CHAIN_ID) await switchNetwork();
    const { BrowserProvider } = await loadEthers();
    const provider = new BrowserProvider(eth);
    return provider.getSigner();
  }, [account, connect, switchNetwork]);

  const getContract = useCallback(async () => getMindChain(await getSigner()), [getSigner]);

  // Proves wallet ownership to the backend by signing a single-use challenge.
  const linkWallet = useCallback(async () => {
    const signer = await getSigner();
    const address = (await signer.getAddress()).toLowerCase();
    const { data } = await api.post('/wallet/nonce', { address });
    let signature;
    try {
      signature = await signer.signMessage(data.message);
    } catch (err) {
      throw new Error(describeChainError(err));
    }
    await api.post('/wallet/verify', { address, nonce: data.nonce, signature });
    await refreshUser();
    return address;
  }, [getSigner, refreshUser]);

  const linkedAddress = user?.walletAddress ?? null;
  const value = useMemo(
    () => ({
      hasProvider,
      account,
      chainId,
      connecting,
      error,
      expectedChainId: EXPECTED_CHAIN_ID,
      networkName: NETWORK_NAME,
      onExpectedNetwork: chainId === EXPECTED_CHAIN_ID,
      linkedAddress,
      // The connected MetaMask account is the one linked to this MindChain account.
      isLinkedAccount: Boolean(account && linkedAddress && account === linkedAddress),
      connect,
      switchNetwork,
      getSigner,
      getContract,
      linkWallet,
    }),
    [hasProvider, account, chainId, connecting, error, linkedAddress, connect, switchNetwork, getSigner, getContract, linkWallet],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside WalletProvider');
  return ctx;
}
