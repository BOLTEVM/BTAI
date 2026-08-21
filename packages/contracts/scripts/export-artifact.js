/**
 * Exports the compiled TalentAgent ABI + deploy bytecode into the frontend so
 * the browser deploy flow can put an escrow on-chain with no backend and no
 * build step at runtime.
 *
 * Run with:  pnpm --filter contracts export:artifact
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const OUT_PATH = path.join(
    __dirname,
    "..", "..", "..",
    "apps", "frontend", "src", "lib", "talentAgent.generated.ts"
);

async function main() {
    await hre.run("compile");

    const artifact = await hre.artifacts.readArtifact("TalentAgent");
    const { abi, bytecode } = artifact;

    if (!bytecode || !bytecode.startsWith("0x") || bytecode.length < 100) {
        throw new Error("TalentAgent artifact carries no usable deploy bytecode.");
    }
    const functions = abi.filter((e) => e.type === "function").map((e) => e.name);
    if (!functions.includes("create_and_deposit")) {
        throw new Error("Compiled ABI is missing create_and_deposit — is the artifact stale?");
    }

    const compiler = `vyper ${hre.config.vyper.compilers?.[0]?.version ?? hre.config.vyper.version}`;
    const header = [
        "// AUTO-GENERATED — do not edit by hand.",
        "// Regenerate with: pnpm --filter contracts export:artifact",
        "//",
        "// Source:   packages/contracts/contracts/TalentAgent.vy",
        `// Compiler: ${compiler}`,
        "//",
        "// The bytecode is embedded so the browser deploy flow can put an escrow",
        "// on-chain without a backend or a build step at runtime.",
        "",
        "",
    ].join("\n");

    const body =
        `export const TALENT_AGENT_ABI = ${JSON.stringify(abi, null, 2)} as const;\n\n` +
        `export const TALENT_AGENT_BYTECODE = "${bytecode}" as const;\n\n` +
        `export const TALENT_AGENT_COMPILER = "${compiler}" as const;\n`;

    fs.writeFileSync(OUT_PATH, header + body, "utf8");
    console.log(`Exported TalentAgent (${(bytecode.length - 2) / 2} bytes, ${compiler}) to ${OUT_PATH}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
