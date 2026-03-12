const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TalentAgent", function () {
    let talentAgent;
    let agent;
    let talent;
    let client;
    let otherAccount;

    beforeEach(async function () {
        [agent, talent, client, otherAccount] = await ethers.getSigners();
        const TalentAgent = await ethers.getContractFactory("TalentAgent");
        talentAgent = await TalentAgent.deploy();
        await talentAgent.deployed();
    });

    describe("Deployment", function () {
        it("Should set the right agent", async function () {
            expect(await talentAgent.agent()).to.equal(agent.address);
        });
    });

    describe("Agreements", function () {
        const amount = ethers.utils.parseEther("1.0");

        it("Should create an agreement", async function () {
            await expect(talentAgent.create_agreement(talent.address, amount))
                .to.emit(talentAgent, "AgreementCreated")
                .withArgs(0, talent.address, ethers.constants.AddressZero, amount);

            const ag = await talentAgent.agreements(0);
            expect(ag.talent).to.equal(talent.address);
            expect(ag.amount).to.equal(amount);
            expect(ag.status).to.equal(0);
        });

        it("Should allow deposit", async function () {
            await talentAgent.create_agreement(talent.address, amount);
            await expect(talentAgent.connect(client).deposit(0, { value: amount }))
                .to.emit(talentAgent, "FundsDeposited")
                .withArgs(0, amount);

            const ag = await talentAgent.agreements(0);
            expect(ag.client).to.equal(client.address);
            expect(ag.deposited).to.equal(amount);
            expect(ag.status).to.equal(1);
        });

        it("Should release funds", async function () {
            await talentAgent.create_agreement(talent.address, amount);
            await talentAgent.connect(client).deposit(0, { value: amount });

            const initialTalentBalance = await talent.getBalance();
            await talentAgent.release_funds(0, amount);
            const finalTalentBalance = await talent.getBalance();

            expect(finalTalentBalance.sub(initialTalentBalance)).to.equal(amount);

            const ag = await talentAgent.agreements(0);
            expect(ag.status).to.equal(2);
            expect(ag.paid_out).to.equal(amount);
        });

        it("Should cancel and refund", async function () {
            await talentAgent.create_agreement(talent.address, amount);
            await talentAgent.connect(client).deposit(0, { value: amount });

            const initialClientBalance = await client.getBalance();
            await talentAgent.cancel_agreement(0);
            const finalClientBalance = await client.getBalance();

            expect(finalClientBalance.gt(initialClientBalance)).to.be.true;

            const ag = await talentAgent.agreements(0);
            expect(ag.status).to.equal(3);
        });
    });

    describe("Authorization", function () {
        const amount = ethers.utils.parseEther("1.0");

        it("Should only allow agent or talent to create agreement", async function () {
            await expect(talentAgent.connect(otherAccount).create_agreement(talent.address, amount))
                .to.be.revertedWith("Unauthorized");
        });

        it("Should only allow agent or client to release funds", async function () {
            await talentAgent.create_agreement(talent.address, amount);
            await talentAgent.connect(client).deposit(0, { value: amount });
            await expect(talentAgent.connect(otherAccount).release_funds(0, amount))
                .to.be.revertedWith("Unauthorized");
        });
    });
});
