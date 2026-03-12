const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TalentAgent", function () {
    let talentAgent;
    let mockToken;
    let agent;
    let talent;
    let client;
    let otherAccount;

    const amount = ethers.utils.parseEther("1.0");

    beforeEach(async function () {
        [agent, talent, client, otherAccount] = await ethers.getSigners();

        // Deploy Mock USDC
        const MockToken = await ethers.getContractFactory("MockERC20");
        mockToken = await MockToken.deploy();
        await mockToken.deployed();

        // Deploy TalentAgent
        const TalentAgent = await ethers.getContractFactory("TalentAgent");
        talentAgent = await TalentAgent.deploy();
        await talentAgent.deployed();

        // Give client some tokens
        await mockToken.mint(client.address, amount.mul(10));
    });

    describe("Deployment", function () {
        it("Should set the right agent", async function () {
            expect(await talentAgent.agent()).to.equal(agent.address);
        });
    });

    describe("Agreements (x402)", function () {
        it("Should create an agreement with a token", async function () {
            await expect(talentAgent.create_agreement(talent.address, mockToken.address, amount))
                .to.emit(talentAgent, "AgreementCreated")
                .withArgs(0, talent.address, ethers.constants.AddressZero, amount);

            const ag = await talentAgent.agreements(0);
            expect(ag.talent).to.equal(talent.address);
            expect(ag.token).to.equal(mockToken.address);
            expect(ag.amount).to.equal(amount);
            expect(ag.status).to.equal(0);
        });

        it("Should allow token deposit (x402 Input)", async function () {
            await talentAgent.create_agreement(talent.address, mockToken.address, amount);

            // Client must approve the contract
            await mockToken.connect(client).approve(talentAgent.address, amount);

            await expect(talentAgent.connect(client).deposit(0))
                .to.emit(talentAgent, "FundsDeposited")
                .withArgs(0, amount);

            const ag = await talentAgent.agreements(0);
            expect(ag.client).to.equal(client.address);
            expect(ag.deposited).to.equal(amount);
            expect(await mockToken.balanceOf(talentAgent.address)).to.equal(amount);
            expect(ag.status).to.equal(1);
        });

        it("Should release tokens (x402 Output)", async function () {
            await talentAgent.create_agreement(talent.address, mockToken.address, amount);
            await mockToken.connect(client).approve(talentAgent.address, amount);
            await talentAgent.connect(client).deposit(0);

            const initialTalentBalance = await mockToken.balanceOf(talent.address);
            await talentAgent.release_funds(0, amount);
            const finalTalentBalance = await mockToken.balanceOf(talent.address);

            expect(finalTalentBalance.sub(initialTalentBalance)).to.equal(amount);

            const ag = await talentAgent.agreements(0);
            expect(ag.status).to.equal(2);
            expect(ag.paid_out).to.equal(amount);
        });

        it("Should cancel and refund tokens", async function () {
            await talentAgent.create_agreement(talent.address, mockToken.address, amount);
            await mockToken.connect(client).approve(talentAgent.address, amount);
            await talentAgent.connect(client).deposit(0);

            const initialClientBalance = await mockToken.balanceOf(client.address);
            await talentAgent.cancel_agreement(0);
            const finalClientBalance = await mockToken.balanceOf(client.address);

            expect(finalClientBalance.sub(initialClientBalance)).to.equal(amount);

            const ag = await talentAgent.agreements(0);
            expect(ag.status).to.equal(3);
        });
    });

    describe("Authorization", function () {
        it("Should only allow agent or talent to create agreement", async function () {
            await expect(talentAgent.connect(otherAccount).create_agreement(talent.address, mockToken.address, amount))
                .to.be.revertedWith("Unauthorized");
        });

        it("Should only allow agent or client to release funds", async function () {
            await talentAgent.create_agreement(talent.address, mockToken.address, amount);
            await mockToken.connect(client).approve(talentAgent.address, amount);
            await talentAgent.connect(client).deposit(0);
            await expect(talentAgent.connect(otherAccount).release_funds(0, amount))
                .to.be.revertedWith("Unauthorized");
        });
    });
});
