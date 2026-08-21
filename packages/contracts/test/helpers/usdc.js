const { ethers, network } = require("hardhat");
const { USDC_ABI, getUsdc } = require("../../usdc");

/**
 * Attach to the real, canonical USDC deployment on the forked network.
 * Fails loudly if the fork is not actually serving USDC, so a misconfigured
 * fork can never be mistaken for a passing escrow test.
 */
async function attachUsdc(networkKey = "base") {
    const deployment = getUsdc(networkKey);
    const usdc = await ethers.getContractAt(USDC_ABI, deployment.address);

    const [symbol, decimals] = await Promise.all([usdc.symbol(), usdc.decimals()]);
    if (symbol !== "USDC" || decimals !== deployment.decimals) {
        throw new Error(
            `Expected canonical USDC at ${deployment.address} on ${deployment.label}, ` +
            `but found symbol="${symbol}" decimals=${decimals}. Is BASE_RPC_URL pointing at the right chain?`
        );
    }

    return { usdc, deployment };
}

/**
 * Credit `holder` with real USDC on the fork by writing the token's balance slot.
 *
 * The slot index is discovered rather than hardcoded: we probe candidate slots,
 * write, and keep the one that `balanceOf` actually reflects. That survives
 * FiatToken implementation upgrades and works across every USDC deployment,
 * unlike impersonating a whale whose balance drifts between fork blocks.
 */
async function dealUsdc(usdc, holder, amount) {
    const target = ethers.BigNumber.from(amount);
    const value = ethers.utils.hexZeroPad(target.toHexString(), 32);

    for (let slot = 0; slot < 32; slot += 1) {
        const index = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [holder, slot])
        );
        const previous = await network.provider.send("eth_getStorageAt", [usdc.address, index, "latest"]);

        await network.provider.send("hardhat_setStorageAt", [usdc.address, index, value]);
        if ((await usdc.balanceOf(holder)).eq(target)) {
            return;
        }

        // Wrong slot — restore whatever was there before probing the next one.
        await network.provider.send("hardhat_setStorageAt", [
            usdc.address,
            index,
            ethers.utils.hexZeroPad(previous, 32),
        ]);
    }

    throw new Error(`Could not locate the USDC balance storage slot for ${holder} at ${usdc.address}.`);
}

/** True when the Hardhat network is forking a live chain (see hardhat.config.js). */
function isForked() {
    return Boolean(network.config.forking && network.config.forking.enabled !== false);
}

module.exports = { attachUsdc, dealUsdc, isForked };
