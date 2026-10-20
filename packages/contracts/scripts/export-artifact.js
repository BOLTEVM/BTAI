/**
 * Exports the compiled escrow ABIs + deploy bytecode into the frontend so the
 * browser deploy flow can put an escrow on-chain with no backend and no build
 * step at runtime.
 *
 *   TalentAgent      -> talentAgent.generated.ts      (legacy USDC rail)
 *   TalentAgentQuai  -> talentAgentQuai.generated.ts  (QUAI x402 rail)
 *
 * Run with:  pnpm --filter contracts export:artifact
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const FRONTEND_LIB = path.join(__dirname, "..", "..", "..", "apps", "frontend", "src", "lib");

const EXPORTS = [
    {
        contract: "TalentAgent",
        outFile: "talentAgent.generated.ts",
        prefix: "TALENT_AGENT",
        requiredFns: ["create_and_deposit"],
        source: "packages/contracts/contracts/TalentAgent.vy",
    },
    {
        contract: "TalentAgentQuai",
        outFile: "talentAgentQuai.generated.ts",
        prefix: "TALENT_AGENT_QUAI",
        requiredFns: ["create_and_deposit", "create_and_deposit_for"],
        source: "packages/contracts/contracts/TalentAgentQuai.vy",
    },
];

async function exportOne(spec, compiler) {
    const artifact = await hre.artifacts.readArtifact(spec.contract);
    const { abi, bytecode } = artifact;

    if (!bytecode || !bytecode.startsWith("0x") || bytecode.length < 100) {
        throw new Error(`${spec.contract} artifact carries no usable deploy bytecode.`);
    }
    const functions = abi.filter((e) => e.type === "function").map((e) => e.name);
    for (const fn of spec.requiredFns) {
        if (!functions.includes(fn)) {
            throw new Error(`Compiled ABI is missing ${fn} — is the artifact stale?`);
        }
    }

    const header = [
        "// AUTO-GENERATED — do not edit by hand.",
        "// Regenerate with: pnpm --filter contracts export:artifact",
        "//",
        `// Source:   ${spec.source}`,
        `// Compiler: ${compiler}`,
        "//",
        "// The bytecode is embedded so the browser deploy flow can put an escrow",
        "// on-chain without a backend or a build step at runtime.",
        "",
        "",
    ].join("\n");

    const body =
        `export const ${spec.prefix}_ABI = ${JSON.stringify(abi, null, 2)} as const;\n\n` +
        `export const ${spec.prefix}_BYTECODE = "${bytecode}" as const;\n\n` +
        `export const ${spec.prefix}_COMPILER = "${compiler}" as const;\n`;

    const outPath = path.join(FRONTEND_LIB, spec.outFile);
    fs.writeFileSync(outPath, header + body, "utf8");
    console.log(`Exported ${spec.contract} (${(bytecode.length - 2) / 2} bytes, ${compiler}) to ${outPath}`);
}

async function main() {
    await hre.run("compile");

    const compiler = `vyper ${hre.config.vyper.compilers?.[0]?.version ?? hre.config.vyper.version}`;
    for (const spec of EXPORTS) {
        await exportOne(spec, compiler);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
