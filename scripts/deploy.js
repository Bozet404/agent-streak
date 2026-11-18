const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Deploy AgentStreak.
 *
 * Env vars:
 *   AGENT_ID_ADDRESS  address of the Agent ID registry (required)
 *                       mainnet: 0x60b9262456de011f7d15a54cdd8c48baaa8b022f
 *   DEPLOYER_KEY      deployer private key (required on live networks,
 *                       read by hardhat.config.js)
 *
 * Usage:
 *   AGENT_ID_ADDRESS=0x60b9... DEPLOYER_KEY=0x... npx hardhat run scripts/deploy.js --network bsc
 *
 * Writes deployment.json next to this script's project root.
 */
async function main() {
  const agentId = process.env.AGENT_ID_ADDRESS;
  if (!agentId || !/^0x[0-9a-fA-F]{40}$/.test(agentId)) {
    throw new Error("AGENT_ID_ADDRESS env var must be a valid address");
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log("Network:   ", hre.network.name);
  console.log("Deployer:  ", deployer.address);

  const AgentStreak = await hre.ethers.getContractFactory("AgentStreak");
  const streak = await AgentStreak.deploy(agentId);
  await streak.waitForDeployment();
  const address = await streak.getAddress();

  console.log("AgentStreak deployed to:", address);

  const deployment = {
    network: hre.network.name,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    contract: "AgentStreak",
    address,
    agentId,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };
  const outPath = path.join(__dirname, "..", "deployment.json");
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));
  console.log("Wrote", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
