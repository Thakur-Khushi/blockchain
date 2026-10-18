// Copies the deployed MindChain address and ABI to the server and client.
// Run after `hardhat ignition deploy` (see `npm run deploy:local`).
// Only public information is written: chain id, contract address and ABI.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const chainId = Number(process.argv[2] ?? 31337);

const addressesFile = path.join(root, "ignition", "deployments", `chain-${chainId}`, "deployed_addresses.json");
const artifactFile = path.join(root, "artifacts", "contracts", "MindChain.sol", "MindChain.json");

if (!fs.existsSync(addressesFile)) {
  console.error(`No Ignition deployment found for chain ${chainId} (${addressesFile}). Deploy first.`);
  process.exit(1);
}

const address = JSON.parse(fs.readFileSync(addressesFile, "utf8"))["MindChainModule#MindChain"];
const { abi } = JSON.parse(fs.readFileSync(artifactFile, "utf8"));
const deployment = {
  contractName: "MindChain",
  chainId,
  networkName: chainId === 31337 ? "Hardhat Local" : `Chain ${chainId}`,
  address,
  abi,
  exportedAt: new Date().toISOString(),
};

const targets = [
  path.join(root, "..", "server", "src", "config", "deployment.json"),
  path.join(root, "..", "client", "src", "contracts", "deployment.json"),
];
for (const target of targets) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(deployment, null, 2));
  console.log(`Wrote ${path.relative(path.join(root, ".."), target)}`);
}
console.log(`MindChain at ${address} on chain ${chainId}`);
