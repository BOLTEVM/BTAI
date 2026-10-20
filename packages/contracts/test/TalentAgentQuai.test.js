const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * TalentAgentQuai — QUAI Network escrow suite.
 *
 * QUAI has no canonical USDC to fork, so this suite settles against the pinned
 * TestSettlementToken (6 decimals, return-true semantics). It runs on the local
 * Hardhat network — no fork required — and covers the agency features that
 * TalentAgent.vy does not have: milestones, protocol fee, two-step agent
 * transfer, dispute-timeout refund, pause invariants, and the token allowlist.
 */
describe("TalentAgentQuai", function () {
    let escrow;
    let token;
    let otherToken;
    let agent;
    let newAgent;
    let talent;
    let client;
    let treasury;
    let otherAccount;

    const DECIMALS = 6;
    const FEE_BPS = 250; // 2.5%
    const DISPUTE_WINDOW = 604800; // 7 days, inside [3d, 30d]
    const milestoneAmounts = [
        ethers.utils.parseUnits("1.0", DECIMALS),
        ethers.utils.parseUnits("2.0", DECIMALS),
        ethers.utils.parseUnits("3.0", DECIMALS),
    ];
    const total = milestoneAmounts.reduce((acc, a) => acc.add(a), ethers.BigNumber.from(0));

    const feeOf = (amount) => amount.mul(FEE_BPS).div(10000);

    beforeEach(async function () {
        [agent, newAgent, talent, client, treasury, otherAccount] = await ethers.getSigners();

        const Token = await ethers.getContractFactory("TestSettlementToken");
        token = await Token.deploy();
        await token.deployed();
        otherToken = await Token.deploy();
        await otherToken.deployed();

        const Escrow = await ethers.getContractFactory("TalentAgentQuai");
        escrow = await Escrow.deploy(token.address, treasury.address, FEE_BPS);
        await escrow.deployed();

        await token.mint(client.address, total.mul(10));
    });

    describe("Deployment", function () {
        it("Should set agent, fee, and seed the token allowlist", async function () {
            expect(await escrow.agent()).to.equal(agent.address);
            expect(await escrow.fee_bps()).to.equal(FEE_BPS);
            expect(await escrow.fee_recipient()).to.equal(treasury.address);
            expect(await escrow.allowed_tokens(token.address)).to.equal(true);
            expect(await escrow.allowed_tokens(otherToken.address)).to.equal(false);
            expect(await escrow.paused()).to.equal(false);
        });

        it("Should reject a fee above the cap or a fee without a recipient", async function () {
            const Escrow = await ethers.getContractFactory("TalentAgentQuai");
            await expect(Escrow.deploy(token.address, treasury.address, 1001)).to.be.revertedWith("Fee exceeds cap");
            await expect(Escrow.deploy(token.address, ethers.constants.AddressZero, 100))
                .to.be.revertedWith("Fee recipient required");
        });
    });

    describe("Token allowlist", function () {
        it("Should reject agreements in non-allowlisted tokens", async function () {
            await expect(
                escrow.create_agreement(talent.address, otherToken.address, milestoneAmounts, DISPUTE_WINDOW)
            ).to.be.revertedWith("Token not allowlisted");
            await token.mint(client.address, total);
            await token.connect(client).approve(escrow.address, total);
            await expect(
                escrow.connect(client).create_and_deposit(talent.address, otherToken.address, milestoneAmounts, DISPUTE_WINDOW)
            ).to.be.revertedWith("Token not allowlisted");
        });

        it("Should let only the agent update the allowlist", async function () {
            await expect(escrow.connect(otherAccount).set_token_allowed(otherToken.address, true))
                .to.be.revertedWith("Only agent");
            await expect(escrow.set_token_allowed(otherToken.address, true))
                .to.emit(escrow, "TokenAllowanceUpdated")
                .withArgs(otherToken.address, true);
            expect(await escrow.allowed_tokens(otherToken.address)).to.equal(true);
        });
    });

    describe("Agreements", function () {
        it("Should create an unfunded agreement (agent or talent only)", async function () {
            await expect(escrow.create_agreement(talent.address, token.address, milestoneAmounts, DISPUTE_WINDOW))
                .to.emit(escrow, "AgreementCreated")
                .withArgs(0, talent.address, ethers.constants.AddressZero, total, milestoneAmounts.length);

            const ag = await escrow.get_agreement(0);
            expect(ag[0]).to.equal(talent.address); // talent
            expect(ag[1]).to.equal(ethers.constants.AddressZero); // client
            expect(ag[3]).to.equal(total); // milestone total
            expect(ag[4]).to.equal(0); // deposited
            expect(ag[6]).to.equal(0); // status Created
            expect(await escrow.get_milestone_count(0)).to.equal(3);

            await expect(
                escrow.connect(otherAccount).create_agreement(talent.address, token.address, milestoneAmounts, DISPUTE_WINDOW)
            ).to.be.revertedWith("Unauthorized");
        });

        it("Should reject empty milestones, zero amounts, and out-of-bounds windows", async function () {
            await expect(escrow.create_agreement(talent.address, token.address, [], DISPUTE_WINDOW))
                .to.be.revertedWith("No milestones");
            await expect(
                escrow.create_agreement(talent.address, token.address, [ethers.BigNumber.from(0)], DISPUTE_WINDOW)
            ).to.be.revertedWith("Milestone amount must be greater than zero");
            await expect(escrow.create_agreement(talent.address, token.address, milestoneAmounts, 60))
                .to.be.revertedWith("Dispute window out of bounds");
            await expect(
                escrow.create_agreement(talent.address, token.address, milestoneAmounts, DISPUTE_WINDOW * 6)
            ).to.be.revertedWith("Dispute window out of bounds");
        });

        it("Should let a client deposit into a created agreement", async function () {
            await escrow.create_agreement(talent.address, token.address, milestoneAmounts, DISPUTE_WINDOW);
            await token.connect(client).approve(escrow.address, total);

            await expect(escrow.connect(client).deposit(0))
                .to.emit(escrow, "FundsDeposited")
                .withArgs(0, total);

            const ag = await escrow.get_agreement(0);
            expect(ag[1]).to.equal(client.address);
            expect(ag[4]).to.equal(total);
            expect(ag[6]).to.equal(1);
            expect(await token.balanceOf(escrow.address)).to.equal(total);

            await expect(escrow.connect(client).deposit(0)).to.be.revertedWith("Agreement already funded or closed");
        });
    });

    describe("create_and_deposit (x402 input)", function () {
        beforeEach(async function () {
            await token.connect(client).approve(escrow.address, total);
        });

        it("Should open and fund an escrow atomically", async function () {
            await expect(escrow.connect(client).create_and_deposit(talent.address, token.address, milestoneAmounts, DISPUTE_WINDOW))
                .to.emit(escrow, "AgreementCreated")
                .withArgs(0, talent.address, client.address, total, 3)
                .and.to.emit(escrow, "FundsDeposited")
                .withArgs(0, total);

            const ag = await escrow.get_agreement(0);
            expect(ag[1]).to.equal(client.address);
            expect(ag[4]).to.equal(total);
            expect(ag[6]).to.equal(1);
            expect(ag[7]).to.be.gt(0); // funded_at
            expect(ag[8]).to.equal(DISPUTE_WINDOW);
            expect(await token.balanceOf(escrow.address)).to.equal(total);
        });

        it("Should not require the caller to be agent or talent", async function () {
            await token.mint(otherAccount.address, total);
            await token.connect(otherAccount).approve(escrow.address, total);
            await escrow.connect(otherAccount).create_and_deposit(talent.address, token.address, milestoneAmounts, DISPUTE_WINDOW);
            expect((await escrow.get_agreement(0))[1]).to.equal(otherAccount.address);
        });

        it("Should revert without an allowance", async function () {
            await token.connect(client).approve(escrow.address, 0);
            await expect(
                escrow.connect(client).create_and_deposit(talent.address, token.address, milestoneAmounts, DISPUTE_WINDOW)
            ).to.be.reverted;
        });
    });

    describe("Milestone releases (x402 output)", function () {
        beforeEach(async function () {
            await token.connect(client).approve(escrow.address, total);
            await escrow.connect(client).create_and_deposit(talent.address, token.address, milestoneAmounts, DISPUTE_WINDOW);
        });

        it("Should release a milestone with the exact fee split", async function () {
            const fee = feeOf(milestoneAmounts[0]);
            const talentAmount = milestoneAmounts[0].sub(fee);

            await expect(escrow.connect(client).release_milestone(0, 0))
                .to.emit(escrow, "MilestoneReleased")
                .withArgs(0, 0, talentAmount, fee);

            expect(await token.balanceOf(talent.address)).to.equal(talentAmount);
            expect(await token.balanceOf(treasury.address)).to.equal(fee);
            expect((await escrow.get_agreement(0))[5]).to.equal(milestoneAmounts[0]); // paid_out
            expect((await escrow.get_milestone(0, 0))[1]).to.equal(true);
        });

        it("Should complete the agreement after the last milestone", async function () {
            await escrow.connect(client).release_milestone(0, 0);
            await escrow.release_milestone(0, 1); // agent can also release
            await escrow.connect(client).release_milestone(0, 2);

            expect((await escrow.get_agreement(0))[6]).to.equal(2); // Completed
            expect(await token.balanceOf(escrow.address)).to.equal(0);
            expect(await token.balanceOf(talent.address)).to.equal(total.sub(feeOf(total)));
        });

        it("Should reject double release, bad index, and unauthorized callers", async function () {
            await escrow.connect(client).release_milestone(0, 0);
            await expect(escrow.connect(client).release_milestone(0, 0)).to.be.revertedWith("Milestone already released");
            await expect(escrow.connect(client).release_milestone(0, 3)).to.be.revertedWith("Invalid milestone");
            await expect(escrow.connect(otherAccount).release_milestone(0, 1)).to.be.revertedWith("Unauthorized");
        });
    });

    describe("Cancel and timeout refund", function () {
        beforeEach(async function () {
            await token.connect(client).approve(escrow.address, total);
            await escrow.connect(client).create_and_deposit(talent.address, token.address, milestoneAmounts, DISPUTE_WINDOW);
        });

        it("Should let the agent cancel and refund the unreleased remainder", async function () {
            await escrow.connect(client).release_milestone(0, 0);
            const remainder = milestoneAmounts[1].add(milestoneAmounts[2]);
            const before = await token.balanceOf(client.address);

            await expect(escrow.cancel_agreement(0)).to.emit(escrow, "AgreementCancelled").withArgs(0);

            expect((await token.balanceOf(client.address)).sub(before)).to.equal(remainder);
            expect((await escrow.get_agreement(0))[6]).to.equal(3);

            await expect(escrow.connect(otherAccount).cancel_agreement(0)).to.be.revertedWith("Only agent can cancel");
        });

        it("Should let the client refund after the dispute window, not before", async function () {
            await escrow.connect(client).release_milestone(0, 0);
            await expect(escrow.connect(client).refund_after_timeout(0)).to.be.revertedWith("Dispute window still open");

            const fundedAt = (await escrow.get_agreement(0))[7];
            await time.increaseTo(fundedAt.add(DISPUTE_WINDOW)); // exactly at the boundary

            const remainder = milestoneAmounts[1].add(milestoneAmounts[2]);
            const before = await token.balanceOf(client.address);
            await expect(escrow.connect(client).refund_after_timeout(0))
                .to.emit(escrow, "AgreementRefunded")
                .withArgs(0, remainder);
            expect((await token.balanceOf(client.address)).sub(before)).to.equal(remainder);
            expect((await escrow.get_agreement(0))[6]).to.equal(4);
        });

        it("Should only let the client drive the timeout refund", async function () {
            const fundedAt = (await escrow.get_agreement(0))[7];
            await time.increaseTo(fundedAt.add(DISPUTE_WINDOW));
            await expect(escrow.connect(otherAccount).refund_after_timeout(0)).to.be.revertedWith("Only client");
        });
    });

    describe("Two-step agent transfer", function () {
        it("Should transfer the agent role only after acceptance", async function () {
            await expect(escrow.propose_agent(newAgent.address))
                .to.emit(escrow, "AgentTransferProposed")
                .withArgs(agent.address, newAgent.address);

            // Old agent retains power until acceptance; stranger cannot accept.
            await expect(escrow.connect(otherAccount).accept_agent()).to.be.revertedWith("Only pending agent");
            await expect(escrow.connect(newAgent).accept_agent())
                .to.emit(escrow, "AgentTransferred")
                .withArgs(agent.address, newAgent.address);

            expect(await escrow.agent()).to.equal(newAgent.address);
            expect(await escrow.pending_agent()).to.equal(ethers.constants.AddressZero);

            // The old agent is fully out.
            await expect(escrow.propose_agent(agent.address)).to.be.revertedWith("Only agent");
        });

        it("Should reject a zero-address proposal", async function () {
            await expect(escrow.propose_agent(ethers.constants.AddressZero)).to.be.revertedWith("Invalid agent");
        });
    });

    describe("Fee management", function () {
        it("Should cap the fee and require a recipient", async function () {
            await expect(escrow.set_fee(1001, treasury.address)).to.be.revertedWith("Fee exceeds cap");
            await expect(escrow.set_fee(10, ethers.constants.AddressZero)).to.be.revertedWith("Fee recipient required");
            await expect(escrow.set_fee(0, ethers.constants.AddressZero))
                .to.emit(escrow, "FeeUpdated")
                .withArgs(0, ethers.constants.AddressZero);
            await expect(escrow.connect(otherAccount).set_fee(1, treasury.address)).to.be.revertedWith("Only agent");
        });

        it("Should pay no fee when fee_bps is zero", async function () {
            await escrow.set_fee(0, ethers.constants.AddressZero);
            await token.connect(client).approve(escrow.address, total);
            await escrow.connect(client).create_and_deposit(talent.address, token.address, milestoneAmounts, DISPUTE_WINDOW);
            await escrow.connect(client).release_milestone(0, 0);
            expect(await token.balanceOf(talent.address)).to.equal(milestoneAmounts[0]);
            expect(await token.balanceOf(treasury.address)).to.equal(0);
        });
    });

    describe("Pause invariants", function () {
        beforeEach(async function () {
            await token.connect(client).approve(escrow.address, total);
            await escrow.connect(client).create_and_deposit(talent.address, token.address, milestoneAmounts, DISPUTE_WINDOW);
            await escrow.pause();
        });

        it("Should block new deposits while paused", async function () {
            await expect(
                escrow.connect(client).create_and_deposit(talent.address, token.address, milestoneAmounts, DISPUTE_WINDOW)
            ).to.be.revertedWith("Deposits paused");
            await escrow.create_agreement(talent.address, token.address, milestoneAmounts, DISPUTE_WINDOW);
            await expect(escrow.connect(client).deposit(1)).to.be.revertedWith("Deposits paused");
        });

        it("Should never block releases, cancels, or refunds while paused", async function () {
            await escrow.connect(client).release_milestone(0, 0);

            const fundedAt = (await escrow.get_agreement(0))[7];
            await time.increaseTo(fundedAt.add(DISPUTE_WINDOW));
            await escrow.connect(client).refund_after_timeout(0);
            expect((await escrow.get_agreement(0))[6]).to.equal(4);
        });

        it("Should only let the agent pause and unpause", async function () {
            await expect(escrow.connect(otherAccount).pause()).to.be.revertedWith("Only agent");
            await escrow.unpause();
            expect(await escrow.paused()).to.equal(false);
        });
    });

    describe("Gasless x402 settlement (create_and_deposit_for)", function () {
        const nonce = ethers.utils.hexlify(ethers.utils.randomBytes(32));
        let validBefore;
        let domain;
        let types;

        const AUTH_TYPES = {
            EscrowAuthorization: [
                { name: "client", type: "address" },
                { name: "talent", type: "address" },
                { name: "token", type: "address" },
                { name: "total", type: "uint256" },
                { name: "disputeWindow", type: "uint256" },
                { name: "validBefore", type: "uint256" },
                { name: "nonce", type: "bytes32" },
            ],
        };

        const signAuth = async (signer, overrides = {}) => {
            const value = {
                client: client.address,
                talent: talent.address,
                token: token.address,
                total,
                disputeWindow: DISPUTE_WINDOW,
                validBefore,
                nonce,
                ...overrides,
            };
            const sig = await signer._signTypedData(domain, AUTH_TYPES, value);
            return { ...ethers.utils.splitSignature(sig), value };
        };

        const settle = (sig) =>
            escrow.create_and_deposit_for(
                sig.value.client,
                sig.value.talent,
                sig.value.token,
                milestoneAmounts,
                sig.value.disputeWindow,
                sig.value.validBefore,
                sig.value.nonce,
                sig.v,
                sig.r,
                sig.s
            );

        beforeEach(async function () {
            const { chainId } = await ethers.provider.getNetwork();
            domain = {
                name: "BTAI Talent Agency",
                version: "1",
                chainId,
                verifyingContract: escrow.address,
            };
            validBefore = (await time.latest()) + 600;
            await token.connect(client).approve(escrow.address, total);
        });

        it("Should settle a signed authorization with the client paying no gas", async function () {
            const sig = await signAuth(client);
            await expect(settle(sig))
                .to.emit(escrow, "AuthorizationUsed")
                .and.to.emit(escrow, "FundsDeposited")
                .withArgs(0, total);

            const ag = await escrow.get_agreement(0);
            expect(ag[1]).to.equal(client.address);
            expect(ag[4]).to.equal(total);
            expect(ag[6]).to.equal(1);
            expect(await token.balanceOf(escrow.address)).to.equal(total);
            expect(await escrow.authorization_used(client.address, nonce)).to.equal(true);
        });

        it("Should reject submission by anyone but the agent", async function () {
            const sig = await signAuth(client);
            await expect(
                escrow.connect(otherAccount).create_and_deposit_for(
                    sig.value.client, sig.value.talent, sig.value.token,
                    milestoneAmounts, sig.value.disputeWindow, sig.value.validBefore,
                    sig.value.nonce, sig.v, sig.r, sig.s
                )
            ).to.be.revertedWith("Only agent");
        });

        it("Should reject an expired authorization", async function () {
            const sig = await signAuth(client, { validBefore: (await time.latest()) - 1 });
            await expect(settle(sig)).to.be.revertedWith("Authorization expired");
        });

        it("Should reject a replayed nonce", async function () {
            const sig = await signAuth(client);
            await settle(sig);
            await token.connect(client).approve(escrow.address, total);
            await expect(settle(sig)).to.be.revertedWith("Authorization already used");
        });

        it("Should reject a signature over different terms", async function () {
            // Client signs a smaller total than the amounts array implies; the
            // recomputed digest no longer matches the signature.
            const sig = await signAuth(client, { total: total.sub(1) });
            await expect(settle(sig)).to.be.revertedWith("Invalid authorization signature");
        });

        it("Should reject a signature from the wrong signer", async function () {
            const sig = await signAuth(otherAccount, { client: client.address });
            await expect(settle(sig)).to.be.revertedWith("Invalid authorization signature");
        });

        it("Should let the client burn an unused authorization", async function () {
            const sig = await signAuth(client);
            await expect(escrow.connect(client).cancel_authorization(nonce))
                .to.emit(escrow, "AuthorizationCancelled");
            await expect(settle(sig)).to.be.revertedWith("Authorization already used");
        });

        it("Should revert settlement without a token allowance", async function () {
            await token.connect(client).approve(escrow.address, 0);
            const sig = await signAuth(client);
            await expect(settle(sig)).to.be.reverted;
        });
    });

    describe("Accounting invariant (I1)", function () {
        it("Should keep contract balance == sum of open escrowed funds", async function () {
            await token.connect(client).approve(escrow.address, total.mul(2));

            await escrow.connect(client).create_and_deposit(talent.address, token.address, milestoneAmounts, DISPUTE_WINDOW);
            await escrow.connect(client).create_and_deposit(talent.address, token.address, milestoneAmounts, DISPUTE_WINDOW);
            expect(await token.balanceOf(escrow.address)).to.equal(total.mul(2));

            await escrow.connect(client).release_milestone(0, 0);
            await escrow.connect(client).release_milestone(1, 1);
            const released = milestoneAmounts[0].add(milestoneAmounts[1]);
            expect(await token.balanceOf(escrow.address)).to.equal(total.mul(2).sub(released));

            await escrow.cancel_agreement(1);
            expect(await token.balanceOf(escrow.address)).to.equal(total.sub(milestoneAmounts[0]));
        });
    });
});
