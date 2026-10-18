import { useCallback, useEffect, useState } from 'react';
import TxStatus from '../components/TxStatus.jsx';
import { Alert, Badge, Button, Card, CardHeader, shortAddress } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useWallet } from '../context/WalletContext.jsx';
import { useTransaction } from '../hooks/useTransaction.js';
import { api, apiErrorMessage } from '../services/api.js';
import { deployment } from '../services/contract.js';

export default function WalletPage() {
  const { user } = useAuth();
  const wallet = useWallet();
  const tx = useTransaction();
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState({ type: null, text: '' });
  const [linking, setLinking] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/wallet');
      setStatus(data);
    } catch (err) {
      setMessage({ type: 'error', text: apiErrorMessage(err) });
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus, user?.walletAddress]);

  const run = (fn) => async () => {
    setMessage({ type: null, text: '' });
    try {
      await fn();
    } catch (err) {
      setMessage({ type: 'error', text: err?.response ? apiErrorMessage(err) : err.message });
    }
  };

  const onLink = run(async () => {
    setLinking(true);
    try {
      const addr = await wallet.linkWallet();
      setMessage({ type: 'success', text: `Wallet ${shortAddress(addr)} is now linked to your account.` });
    } finally {
      setLinking(false);
    }
  });

  const onRegister = run(async () => {
    const contract = await wallet.getContract();
    await tx.run(() => contract.registerPatient());
    await loadStatus();
  });

  const chain = status?.chain;
  const isPatient = user?.role === 'patient';
  const linkedMismatch = wallet.account && wallet.linkedAddress && !wallet.isLinkedAccount;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Wallet & blockchain</h1>
        <p className="mt-1 text-sm text-slate-500">
          Connect MetaMask and prove you own the wallet. {isPatient ? 'Your wallet signs consent and record transactions.' : 'Patients grant access to your linked wallet address.'}
        </p>
      </div>

      {message.text && <Alert type={message.type}>{message.text}</Alert>}

      <Card>
        <CardHeader title="Blockchain network" description="The MindChain contract on the local development network." />
        {!deployment && (
          <Alert type="warning" title="Contract not deployed">
            Run <code className="font-mono">npm run deploy:local</code> in the <code className="font-mono">blockchain</code> folder, then reload.
          </Alert>
        )}
        {chain && (
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-slate-500">Status</dt>
              <dd className="mt-1">{chain.available ? <Badge color="green">Online</Badge> : <Badge color="red">Unavailable</Badge>}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Chain ID</dt>
              <dd className="mt-1 font-mono">{chain.chainId ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Contract</dt>
              <dd className="mt-1 font-mono" title={chain.contractAddress ?? ''}>{chain.contractAddress ? shortAddress(chain.contractAddress) : '—'}</dd>
            </div>
          </dl>
        )}
        {chain && !chain.available && <p className="mt-3 text-sm text-rose-700">{chain.reason}</p>}
      </Card>

      <Card>
        <CardHeader title="MetaMask" description="The wallet currently selected in your browser extension." />
        {!wallet.hasProvider ? (
          <Alert type="warning" title="MetaMask not detected">
            Install the MetaMask browser extension, then reload this page.
          </Alert>
        ) : !wallet.account ? (
          <Button onClick={run(wallet.connect)} loading={wallet.connecting}>
            Connect MetaMask
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-500">Connected account</span>
              <span className="font-mono" title={wallet.account}>{shortAddress(wallet.account)}</span>
              {wallet.onExpectedNetwork ? (
                <Badge color="green">{wallet.networkName}</Badge>
              ) : (
                <Badge color="yellow">Wrong network (chain {wallet.chainId ?? '?'})</Badge>
              )}
            </div>
            {!wallet.onExpectedNetwork && (
              <Button variant="secondary" onClick={run(wallet.switchNetwork)}>
                Switch to {wallet.networkName}
              </Button>
            )}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Linked wallet"
          description="Linking proves ownership by signing a one-time message. Signing is free and sends no transaction."
        />
        <div className="space-y-3 text-sm">
          <p>
            <span className="text-slate-500">Linked to your account: </span>
            {wallet.linkedAddress ? <span className="font-mono" title={wallet.linkedAddress}>{shortAddress(wallet.linkedAddress)}</span> : <span className="text-slate-400">none</span>}
          </p>
          {linkedMismatch && (
            <Alert type="warning">
              MetaMask is using a different account than the one linked to MindChain. Switch accounts in MetaMask, or link this one.
            </Alert>
          )}
          {wallet.account && !wallet.isLinkedAccount && (
            <Button onClick={onLink} loading={linking}>
              {wallet.linkedAddress ? 'Link this wallet instead' : 'Link this wallet'}
            </Button>
          )}
          {wallet.isLinkedAccount && <Badge color="green">MetaMask account verified</Badge>}
        </div>
      </Card>

      {isPatient && (
        <Card>
          <CardHeader
            title="On-chain registration"
            description="Register your wallet with the MindChain contract once, so you can anchor records and grant therapist access."
          />
          {status?.registeredPatient === true && <Badge color="green">Registered on MindChain</Badge>}
          {status?.registeredPatient === null && wallet.linkedAddress && (
            <p className="text-sm text-slate-500">Registration status is unavailable while the blockchain is offline.</p>
          )}
          {status?.registeredPatient === false && (
            <div className="space-y-3">
              {!wallet.isLinkedAccount && <p className="text-sm text-slate-500">Connect and link your wallet first.</p>}
              <Button onClick={onRegister} disabled={!wallet.isLinkedAccount || tx.busy} loading={tx.busy}>
                Register on MindChain
              </Button>
            </div>
          )}
          {!wallet.linkedAddress && <p className="text-sm text-slate-500">Link a wallet to register.</p>}
          <div className="mt-3">
            <TxStatus tx={tx} />
          </div>
        </Card>
      )}
    </div>
  );
}
