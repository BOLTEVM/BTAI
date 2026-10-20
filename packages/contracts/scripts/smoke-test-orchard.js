/**
 * Live end-to-end smoke test of the x402 settlement path on QUAI Orchard.
 *
 * Exercises exactly what the production rail does:
 *   1. a fresh QUAI-ledger Cyprus-1 client wallet is created;
 *   2. the agent funds it with a little QUAI (for the one-time approval) and
 *      mints it test settlement tokens;
 *   3. the client approves the escrow (its ONLY transaction ever);
 *   4. the client signs an EIP-712 EscrowAuthorization off-chain — no gas;
 *   5. the agent submits create_and_deposit_for on-chain (pays gas);
 *   6. the agent releases a milestone; balances are checked against the
 *      expected talent/fee split.
 *
 * Usage (from packages/contracts):
 *   set -a && . ./.env.quai-deploy && set +a
 *   ESCROW=0x0042bc... TOKEN=0x0043a6... node scripts/smoke-test-orchard.js
 */
const quais = require("quais");
const { ethers } = require("ethers"); // off-chain hashing only — no tx building
const fs = require("fs");
const path = require("path");

// ABI straight from the compiled artifact — a hand-written copy drifted once
// (bytes32 vs uint256 s) and produced calldata for a nonexistent selector.
const ESCROW_ABI = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "artifacts", "contracts", "TalentAgentQuai.vy", "TalentAgentQuai.json"), "utf8")
).abi;

const RPC = process.env.QUAI_RPC_URL || "https://orchard.rpc.quai.network";
const CHAIN_ID = 15000;
const ESCROW = process.env.ESCROW;
const TOKEN = process.env.TOKEN;

// Pinned in TalentAgentQuai.vy — keccak256 of the EscrowAuthorization type string.
const AUTH_TYPEHASH = "0x8a7234c8fe78c76155f46adc8f44f2def476c3f525c1c9b622af2dbd64f21a66";

const ERC20_ABI = [
    "function mint(address to, uint256 value) returns (bool)",
    "function approve(address spender, uint256 value) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address, address) view returns (uint256)",
];

function newQuaiAccount() {
    for (;;) {
        const w = ethers.Wallet.createRandom();
        if (w.address.toLowerCase().startsWith("0x00") && parseInt(w.address.slice(4, 6), 16) < 0x80) return w;
    }
}

async function main() {
    if (!ESCROW || !TOKEN) throw new Error("Set ESCROW and TOKEN env vars.");
    const key = process.env.DEPLOYER_PRIVATE_KEY;
    if (!key) throw new Error("DEPLOYER_PRIVATE_KEY is not set.");

    const provider = new quais.JsonRpcProvider(RPC, undefined, { usePathing: true });
    const agent = new quais.Wallet(key, provider);
    const token = new quais.Contract(TOKEN, ERC20_ABI, agent);
    const escrow = new quais.Contract(ESCROW, ESCROW_ABI, agent);

    const client = newQuaiAccount();
    const talent = newQuaiAccount();
    console.log(`agent:  ${agent.address}`);
    console.log(`client: ${client.address}`);
    console.log(`talent: ${talent.address}`);

    // 1. Fund the client for its single approval transaction, and mint tokens.
    const TOTAL = quais.parseUnits("10", 6); // 10.000000 TST (bigint)
    console.log("\n[1] funding client gas + minting 10 TST...");
    const fundTx = new quais.QuaiTransaction(agent.address);
    fundTx.to = client.address;
    fundTx.value = quais.parseQuai("0.5");
    await (await agent.sendTransaction(fundTx)).wait();
    await (await token.mint(client.address, TOTAL)).wait();

    // 2. Client's only transaction: approve the escrow.
    console.log("[2] client approves escrow...");
    const clientWallet = new quais.Wallet(client.privateKey, provider);
    const clientToken = new quais.Contract(TOKEN, ERC20_ABI, clientWallet);
    await (await clientToken.approve(ESCROW, TOTAL)).wait();

    // 3. Client signs the EIP-712 EscrowAuthorization off-chain. The domain
    // separator is read from the contract itself, so it can never drift from
    // what the escrow will verify against.
    console.log("[3] client signs EscrowAuthorization (gasless)...");
    const domainSeparator = await escrow.domain_separator();
    const nonce = quais.hexlify(quais.randomBytes(32));
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 300);
    const disputeWindow = BigInt(3 * 24 * 3600); // contract minimum
    const amounts = [TOTAL / 2n, TOTAL - TOTAL / 2n]; // 2 milestones

    const structHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
            ["bytes32", "address", "address", "address", "uint256", "uint256", "uint256", "bytes32"],
            [AUTH_TYPEHASH, client.address, talent.address, TOKEN, TOTAL, disputeWindow, validBefore, nonce]
        )
    );
    const digest = ethers.utils.keccak256(ethers.utils.concat(["0x1901", domainSeparator, structHash]));
    const sig = new quais.SigningKey(client.privateKey).sign(digest);

    // Vyper's ecrecover enforces EIP-2 low-s (malleability protection), while
    // quais's SigningKey does not normalize. Normalize here, exactly as
    // production wallets (Pelagus/MetaMask) already do.
    const SECP256K1N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
    let v = sig.v;
    let s = BigInt(sig.s);
    if (s > SECP256K1N / 2n) {
        s = SECP256K1N - s;
        v = v === 27 ? 28 : 27;
    }
    const sHex = "0x" + s.toString(16).padStart(64, "0");

    // 4. Agent settles on-chain — the client pays no gas. Static-call first so
    // a revert surfaces its reason string instead of a bare estimateGas error.
    console.log("[4] agent settles via create_and_deposit_for...");
    const callData = escrow.interface.encodeFunctionData("create_and_deposit_for", [
        client.address,
        talent.address,
        TOKEN,
        amounts.map((a) => a.toString()),
        disputeWindow,
        validBefore,
        nonce,
        v,
        sig.r,
        sHex,
    ]);
    // The escrow is shared across runs — our agreement id is the count BEFORE
    // settle, not necessarily 0.
    const agreementId = await escrow.agreement_count();
    try {
        await provider.call({ to: ESCROW, data: callData, from: agent.address });
        console.log("    static call OK");
    } catch (e) {
        // Orchard's call/estimateGas path is unreliable for nested contract
        // calls (null-data failures on calls that succeed when mined) — log
        // and proceed; the mined receipt is the real verdict.
        console.log(`    static call inconclusive (${(e.reason || e.code || "null-data")}); sending anyway...`);
    }
    const settleTx = new quais.QuaiTransaction(agent.address);
    settleTx.to = ESCROW;
    settleTx.data = callData;
    // Orchard's estimateGas is unreliable for nested calls (observed null-data
    // failures on a call that succeeds on-chain); set the limit explicitly
    // using the locally measured 368,735 gas plus headroom.
    settleTx.gasLimit = BigInt(process.env.GAS_LIMIT || "2000000");
    // CRITICAL Orchard workaround: do NOT attach an explicit EMPTY access list.
    // go-quai's mined execution burns the entire gas limit (INVALID-style, no
    // revert data) for a legacy tx carrying accessList=[] — while eth_call on
    // the identical input/state succeeds. Letting quais populate the access
    // list via eth_createAccessList produces a tx that mines correctly.
    // Set ACCESS_LIST=empty only to reproduce that chain bug.
    if (process.env.ACCESS_LIST === "empty") settleTx.accessList = [];
    const tx = await agent.sendTransaction(settleTx);
    const receipt = await tx.wait();
    console.log(`    settled in tx ${receipt.transactionHash ?? receipt.hash} (gasUsed ${receipt.gasUsed})`);

    const used = await escrow.authorization_used(client.address, nonce);
    const agreement = await escrow.get_agreement(agreementId);
    const deposited = agreement[4];
    const status = agreement[6];
    console.log(`    authorization burned: ${used} | agreement #${agreementId} deposited: ${quais.formatUnits(deposited, 6)} TST (status ${status})`);
    if (!used || deposited !== TOTAL || Number(status) !== 1) {
        throw new Error("Escrow state mismatch after settlement");
    }

    // 5. Release milestone 0 and verify the fee split (250 bps = 2.5%).
    // Compare balance DELTAS — the agent accrues fees across runs.
    console.log("[5] releasing milestone 0 and checking the split...");
    const talentBefore = await token.balanceOf(talent.address);
    const feeBefore = await token.balanceOf(agent.address);
    await (await escrow.release_milestone(agreementId, 0)).wait();
    const m0 = amounts[0];
    const expectedFee = (m0 * 250n) / 10000n;
    const talentBal = (await token.balanceOf(talent.address)) - talentBefore;
    const feeBal = (await token.balanceOf(agent.address)) - feeBefore;
    console.log(`    talent received: ${quais.formatUnits(talentBal, 6)} TST (expected ${quais.formatUnits(m0 - expectedFee, 6)})`);
    console.log(`    fee received:    ${quais.formatUnits(feeBal, 6)} TST (expected ${quais.formatUnits(expectedFee, 6)})`);
    if (talentBal !== m0 - expectedFee || feeBal !== expectedFee) {
        throw new Error("Fee split mismatch");
    }

    console.log("\nSMOKE TEST PASSED — gasless x402 settlement works end-to-end on Orchard.");
}

main().catch((error) => {
    console.error("SMOKE TEST FAILED:", error.message || error);
    process.exitCode = 1;
});
