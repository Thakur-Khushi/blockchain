// Test-only stand-in for MetaMask: an EIP-1193 provider injected into the page.
// Account/chain requests are answered locally; everything else (personal_sign,
// eth_sendTransaction, receipts, calls) is forwarded to the Hardhat node, which
// signs with its unlocked dev account. The app code path is the same as with
// MetaMask; only the confirmation popup is skipped.
const RPC = process.env.E2E_RPC_URL ?? 'http://127.0.0.1:8555';

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  return res.json();
}

export async function hardhatAccount(index) {
  const { result } = await rpc('eth_accounts');
  return result[index].toLowerCase();
}

export async function injectWallet(context, accountIndex) {
  const address = await hardhatAccount(accountIndex);
  await context.exposeBinding('__mindchainRpc', async (_source, method, params) => {
    const body = await rpc(method, params);
    return body.error ? { error: body.error } : { result: body.result };
  });
  await context.addInitScript(({ address: addr }) => {
    window.ethereum = {
      isMetaMask: true,
      async request({ method, params = [] }) {
        switch (method) {
          case 'eth_requestAccounts':
          case 'eth_accounts':
            return [addr];
          case 'eth_chainId':
            return '0x7a69';
          case 'net_version':
            return '31337';
          case 'wallet_switchEthereumChain':
          case 'wallet_addEthereumChain':
            return null;
          default: {
            const res = await window.__mindchainRpc(method, params);
            if (res.error) {
              const err = new Error(res.error.message);
              err.code = res.error.code;
              err.data = res.error.data;
              throw err;
            }
            return res.result;
          }
        }
      },
      on() {},
      removeListener() {},
    };
  }, { address });
  return address;
}
