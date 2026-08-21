const { expect } = require("chai");
const { ethers } = require("hardhat");
const { attachUsdc, dealUsdc, isForked } = require("./helpers/usdc");

describe("TalentAgent", function () {
    let talentAgent;
    let usdc;
    let deployment;
    let agent;
    let talent;
    let client;
    let otherAccount;

    // Real USDC is 6 decimals, so an hourly rate of 1 USDC is 1_000_000 units.
    const amount = ethers.utils.parseUnits("1.0", 6);

    before(function () {
        if (!isForked()) {
            console.warn(
                "\n  Skipping TalentAgent escrow suite: it settles in real USDC and needs a chain fork.\n" +
                "  Set BASE_RPC_URL (and optionally FORK_BLOCK_NUMBER) to run it.\n"
            );
            this.skip();
        }
    });

    beforeEach(async function () {
        [agent, talent, client, otherAccount] = await ethers.getSigners();

        // Real, canonical Circle USDC on the forked chain — no mock token.
        ({ usdc, deployment } = await attachUsdc("base"));

        const TalentAgent = await ethers.getContractFactory("TalentAgent");
        talentAgent = await TalentAgent.deploy();
        await talentAgent.deployed();

        // Fund the client with real USDC by writing the token's own balance slot.
        await dealUsdc(usdc, client.address, amount.mul(10));
    });

    describe("Deployment", function () {
        it("Should set the right agent", async function () {
            expect(await talentAgent.agent()).to.equal(agent.address);
        });

        it("Should escrow canonical 6-decimal USDC", async function () {
            expect(await usdc.decimals()).to.equal(6);
            expect(usdc.address).to.equal(deployment.address);
            expect(await usdc.balanceOf(client.address)).to.equal(amount.mul(10));
        });
    });

    describe("Agreements (x402)", function () {
        it("Should create an agreement with USDC as the settlement token", async function () {
            await expect(talentAgent.create_agreement(talent.address, usdc.address, amount))
                .to.emit(talentAgent, "AgreementCreated")
                .withArgs(0, talent.address, ethers.constants.AddressZero, amount);

            const ag = await talentAgent.agreements(0);
            expect(ag.talent).to.equal(talent.address);
            expect(ag.token).to.equal(usdc.address);
            expect(ag.amount).to.equal(amount);
            expect(ag.status).to.equal(0);
        });

        it("Should allow USDC deposit (x402 Input)", async function () {
            await talentAgent.create_agreement(talent.address, usdc.address, amount);

            // Client must approve the escrow to pull USDC.
            await usdc.connect(client).approve(talentAgent.address, amount);

            await expect(talentAgent.connect(client).deposit(0))
                .to.emit(talentAgent, "FundsDeposited")
                .withArgs(0, amount);

            const ag = await talentAgent.agreements(0);
            expect(ag.client).to.equal(client.address);
            expect(ag.deposited).to.equal(amount);
            expect(await usdc.balanceOf(talentAgent.address)).to.equal(amount);
            expect(ag.status).to.equal(1);
        });

        it("Should reject a deposit without a USDC allowance", async function () {
            await talentAgent.create_agreement(talent.address, usdc.address, amount);
            await expect(talentAgent.connect(client).deposit(0)).to.be.reverted;
        });

        it("Should release USDC (x402 Output)", async function () {
            await talentAgent.create_agreement(talent.address, usdc.address, amount);
            await usdc.connect(client).approve(talentAgent.address, amount);
            await talentAgent.connect(client).deposit(0);

            const initialTalentBalance = await usdc.balanceOf(talent.address);
            await talentAgent.release_funds(0, amount);
            const finalTalentBalance = await usdc.balanceOf(talent.address);

            expect(finalTalentBalance.sub(initialTalentBalance)).to.equal(amount);

            const ag = await talentAgent.agreements(0);
            expect(ag.status).to.equal(2);
            expect(ag.paid_out).to.equal(amount);
        });

        it("Should cancel and refund USDC", async function () {
            await talentAgent.create_agreement(talent.address, usdc.address, amount);
            await usdc.connect(client).approve(talentAgent.address, amount);
            await talentAgent.connect(client).deposit(0);

            const initialClientBalance = await usdc.balanceOf(client.address);
            await talentAgent.cancel_agreement(0);
            const finalClientBalance = await usdc.balanceOf(client.address);

            expect(finalClientBalance.sub(initialClientBalance)).to.equal(amount);

            const ag = await talentAgent.agreements(0);
            expect(ag.status).to.equal(3);
        });
    });

    describe("Client-initiated escrow (create_and_deposit)", function () {
        beforeEach(async function () {
            await usdc.connect(client).approve(talentAgent.address, amount);
        });

        it("Should let a client open and fund an escrow in one call", async function () {
            await expect(talentAgent.connect(client).create_and_deposit(talent.address, usdc.address, amount))
                .to.emit(talentAgent, "AgreementCreated")
                .withArgs(0, talent.address, client.address, amount)
                .and.to.emit(talentAgent, "FundsDeposited")
                .withArgs(0, amount);

            const ag = await talentAgent.agreements(0);
            expect(ag.talent).to.equal(talent.address);
            expect(ag.client).to.equal(client.address);
            expect(ag.token).to.equal(usdc.address);
            expect(ag.deposited).to.equal(amount);
            expect(ag.paid_out).to.equal(0);
            expect(ag.status).to.equal(1);
        });

        it("Should move real USDC into the escrow in the same transaction", async function () {
            const initialClientBalance = await usdc.balanceOf(client.address);

            await talentAgent.connect(client).create_and_deposit(talent.address, usdc.address, amount);

            expect(await usdc.balanceOf(talentAgent.address)).to.equal(amount);
            expect(initialClientBalance.sub(await usdc.balanceOf(client.address))).to.equal(amount);
        });

        it("Should release funds to the talent afterwards", async function () {
            await talentAgent.connect(client).create_and_deposit(talent.address, usdc.address, amount);

            const initialTalentBalance = await usdc.balanceOf(talent.address);
            await talentAgent.connect(client).release_funds(0, amount);

            expect((await usdc.balanceOf(talent.address)).sub(initialTalentBalance)).to.equal(amount);
            expect((await talentAgent.agreements(0)).status).to.equal(2);
        });

        it("Should not require the caller to be the agent or the talent", async function () {
            await dealUsdc(usdc, otherAccount.address, amount);
            await usdc.connect(otherAccount).approve(talentAgent.address, amount);

            await expect(talentAgent.connect(otherAccount).create_and_deposit(talent.address, usdc.address, amount))
                .to.emit(talentAgent, "FundsDeposited")
                .withArgs(0, amount);

            expect((await talentAgent.agreements(0)).client).to.equal(otherAccount.address);
        });

        it("Should revert without a USDC allowance", async function () {
            await usdc.connect(client).approve(talentAgent.address, 0);
            await expect(talentAgent.connect(client).create_and_deposit(talent.address, usdc.address, amount))
                .to.be.reverted;
        });

        it("Should reject a zero amount and an empty talent address", async function () {
            await expect(talentAgent.connect(client).create_and_deposit(talent.address, usdc.address, 0))
                .to.be.revertedWith("Amount must be greater than zero");
            await expect(
                talentAgent.connect(client).create_and_deposit(ethers.constants.AddressZero, usdc.address, amount)
            ).to.be.revertedWith("Invalid talent");
        });

        it("Should hand out distinct agreement ids", async function () {
            await usdc.connect(client).approve(talentAgent.address, amount.mul(2));
            await talentAgent.connect(client).create_and_deposit(talent.address, usdc.address, amount);
            await talentAgent.connect(client).create_and_deposit(talent.address, usdc.address, amount);

            expect(await talentAgent.agreement_count()).to.equal(2);
            expect(await usdc.balanceOf(talentAgent.address)).to.equal(amount.mul(2));
        });
    });

    describe("Authorization", function () {
        it("Should only allow agent or talent to create agreement", async function () {
            await expect(talentAgent.connect(otherAccount).create_agreement(talent.address, usdc.address, amount))
                .to.be.revertedWith("Unauthorized");
        });

        it("Should only allow agent or client to release funds", async function () {
            await talentAgent.create_agreement(talent.address, usdc.address, amount);
            await usdc.connect(client).approve(talentAgent.address, amount);
            await talentAgent.connect(client).deposit(0);
            await expect(talentAgent.connect(otherAccount).release_funds(0, amount))
                .to.be.revertedWith("Unauthorized");
        });
    });
});
