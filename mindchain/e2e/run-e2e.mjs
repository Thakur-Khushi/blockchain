// Orchestrates a full end-to-end run on isolated ports, then tears everything down:
//   Hardhat node (:8555) → deploy MindChain → MongoDB test DB → API (:5055)
//   → Vite client (:5174) → Playwright tests in Microsoft Edge/Chrome.
// Secrets are generated per run; nothing is read from or written to server/.env.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const tmp = path.join(here, '.tmp');
fs.mkdirSync(tmp, { recursive: true });

const PORTS = { rpc: 8555, api: 5055, web: 5174 };
const RPC = `http://127.0.0.1:${PORTS.rpc}`;
const MONGO_BASE = process.env.E2E_MONGODB_URL ?? 'mongodb://127.0.0.1:27017';
const MONGODB_URI = `${MONGO_BASE}/mindchain_e2e`;
const ADMIN = { email: 'e2e-admin@example.test', password: `Adm1n-${crypto.randomBytes(6).toString('hex')}` };

const children = [];
function start(name, args, { cwd, env = {} }) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(tmp, `${name}.log`));
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push(child);
  return child;
}

async function waitFor(check, label, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await check()) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${label} (see e2e/.tmp/*.log)`);
}

const rpcCall = async (method, params = []) => {
  const res = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
};

const clientDeployment = path.join(root, 'client', 'src', 'contracts', 'deployment.json');
const backup = fs.existsSync(clientDeployment) ? fs.readFileSync(clientDeployment) : null;

// mongoose is resolved from the server package (the e2e package does not depend on it).
const serverRequire = createRequire(path.join(root, 'server', 'package.json'));

async function dropDb() {
  const mongoose = serverRequire('mongoose');
  const conn = await mongoose.createConnection(MONGODB_URI, { serverSelectionTimeoutMS: 5000 }).asPromise();
  await conn.dropDatabase();
  await conn.close();
}

async function main() {
  // 1. Blockchain
  start('hardhat', [path.join(root, 'blockchain', 'node_modules', 'hardhat', 'dist', 'src', 'cli.js'), 'node', '--port', String(PORTS.rpc)], {
    cwd: path.join(root, 'blockchain'),
  });
  await waitFor(async () => (await rpcCall('eth_chainId')) === '0x7a69', 'Hardhat node');

  const artifactPath = path.join(root, 'blockchain', 'artifacts', 'contracts', 'MindChain.sol', 'MindChain.json');
  if (!fs.existsSync(artifactPath)) throw new Error('Compile the contract first: cd blockchain && npm run compile');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const [deployer] = await rpcCall('eth_accounts');
  const txHash = await rpcCall('eth_sendTransaction', [{ from: deployer, data: artifact.bytecode, gas: '0x989680' }]);
  let receipt;
  await waitFor(async () => (receipt = await rpcCall('eth_getTransactionReceipt', [txHash])), 'contract deployment');
  const deployment = {
    contractName: 'MindChain',
    chainId: 31337,
    networkName: 'Hardhat Local',
    address: receipt.contractAddress,
    abi: artifact.abi,
    exportedAt: new Date().toISOString(),
  };
  const serverDeployment = path.join(tmp, 'deployment.json');
  fs.writeFileSync(serverDeployment, JSON.stringify(deployment, null, 2));
  fs.mkdirSync(path.dirname(clientDeployment), { recursive: true });
  fs.writeFileSync(clientDeployment, JSON.stringify(deployment, null, 2));
  console.log(`[e2e] MindChain deployed at ${deployment.address}`);

  // 2. Database + API
  await dropDb();
  const apiEnv = {
    NODE_ENV: 'development',
    PORT: String(PORTS.api),
    MONGODB_URI,
    JWT_SECRET: crypto.randomBytes(48).toString('hex'),
    ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    ENCRYPTION_KEY_VERSION: '1',
    ENCRYPTION_PREVIOUS_KEYS: '',
    RPC_URL: RPC,
    DEPLOYMENT_FILE: serverDeployment,
    CONTRACT_ADDRESS: '',
    CHAIN_ID: '',
    CLIENT_ORIGIN: `http://localhost:${PORTS.web}`,
    AUTH_RATE_LIMIT_MAX: '1000',
    BCRYPT_ROUNDS: '10',
    ADMIN_NAME: 'E2E Administrator',
    ADMIN_EMAIL: ADMIN.email,
    ADMIN_PASSWORD: ADMIN.password,
  };
  const seed = start('seed-admin', ['scripts/seed-admin.js'], { cwd: path.join(root, 'server'), env: apiEnv });
  await new Promise((resolve, reject) => seed.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('seed-admin failed')))));
  start('api', ['src/server.js'], { cwd: path.join(root, 'server'), env: apiEnv });
  await waitFor(async () => (await fetch(`http://localhost:${PORTS.api}/api/health`)).ok, 'API');

  // 3. Client
  start('vite', [path.join(root, 'client', 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORTS.web), '--strictPort'], {
    cwd: path.join(root, 'client'),
    env: { API_PROXY_TARGET: `http://localhost:${PORTS.api}` },
  });
  await waitFor(async () => (await fetch(`http://localhost:${PORTS.web}/api/health`)).ok, 'Vite dev server');

  // 4. Playwright
  const pwCli = path.join(here, 'node_modules', '@playwright', 'test', 'cli.js');
  const extra = process.argv.slice(2);
  const code = await new Promise((resolve) => {
    const pw = spawn(process.execPath, [pwCli, 'test', ...extra], {
      cwd: here,
      stdio: 'inherit',
      env: {
        ...process.env,
        E2E_BASE_URL: `http://localhost:${PORTS.web}`,
        E2E_RPC_URL: RPC,
        E2E_ADMIN_EMAIL: ADMIN.email,
        E2E_ADMIN_PASSWORD: ADMIN.password,
      },
    });
    pw.on('exit', resolve);
  });
  return code;
}

async function teardown() {
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* already gone */
    }
  }
  if (backup) fs.writeFileSync(clientDeployment, backup);
  else if (fs.existsSync(clientDeployment)) fs.rmSync(clientDeployment);
  try {
    await dropDb();
  } catch {
    /* ignore */
  }
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (err) {
  console.error(`[e2e] ${err.message}`);
} finally {
  await teardown();
}
process.exit(exitCode);
