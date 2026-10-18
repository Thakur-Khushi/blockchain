import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("MindChainModule", (m) => {
  const mindChain = m.contract("MindChain");
  return { mindChain };
});
