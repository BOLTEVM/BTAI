/**
 * Copies the Hardhat-compiled artifacts (Vyper bytecode included) into the
 * Foundry project's test-artifacts/ directory, where vm.deployCode picks them
 * up. Run after `npx hardhat compile`.
 *
 * Run with:  node scripts/sync-foundry-artifacts.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TARGETS = [
    ["artifacts/contracts/TalentAgentQuai.vy/TalentAgentQuai.json", "TalentAgentQuai.json"],
    ["artifacts/contracts/TestSettlementToken.sol/TestSettlementToken.json", "TestSettlementToken.json"],
];

const outDir = path.join(ROOT, "foundry", "test-artifacts");
fs.mkdirSync(outDir, { recursive: true });

for (const [srcRel, name] of TARGETS) {
    const src = path.join(ROOT, srcRel);
    if (!fs.existsSync(src)) {
        throw new Error(`Missing artifact ${srcRel} — run npx hardhat compile first.`);
    }
    const artifact = JSON.parse(fs.readFileSync(src, "utf8"));
    if (!artifact.bytecode || artifact.bytecode === "0x") {
        throw new Error(`${srcRel} carries no deploy bytecode.`);
    }
    fs.copyFileSync(src, path.join(outDir, name));
    console.log(`Synced ${srcRel} -> foundry/test-artifacts/${name}`);
}
