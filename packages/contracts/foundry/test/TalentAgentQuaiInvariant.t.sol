// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {ITalentAgentQuai, ITestToken} from "./TalentAgentQuai.t.sol";

/// @dev Drives random valid/invalid sequences of deposits, releases, cancels,
/// refunds and time-warps against the escrow. With fail_on_revert = false the
/// fuzzer discards reverting calls, so the handler may attempt anything.
contract EscrowHandler is Test {
    uint256 constant MIN_WINDOW = 259200;

    ITalentAgentQuai public escrow;
    ITestToken public token;
    address public agent;
    address public client;
    address public talent;

    constructor(ITalentAgentQuai _escrow, ITestToken _token, address _agent, address _client, address _talent) {
        escrow = _escrow;
        token = _token;
        agent = _agent;
        client = _client;
        talent = _talent;
    }

    function deposit(uint256 amountSeed, uint8 milestoneSeed) external {
        uint256 count = bound(milestoneSeed, 1, 4);
        uint256 total = bound(amountSeed, count, 1e12);
        uint256[] memory amounts = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            amounts[i] = total / count;
        }
        amounts[count - 1] += total - (total / count) * count;

        token.mint(client, total);
        vm.prank(client);
        token.approve(address(escrow), total);
        vm.prank(client);
        escrow.create_and_deposit(talent, address(token), amounts, MIN_WINDOW);
    }

    function release(uint256 idSeed, uint256 milestoneSeed) external {
        uint256 n = escrow.agreement_count();
        if (n == 0) return;
        uint256 id = idSeed % n;
        uint256 milestones = escrow.get_milestone_count(id);
        if (milestones == 0) return;
        vm.prank(agent);
        escrow.release_milestone(id, milestoneSeed % milestones);
    }

    function cancel(uint256 idSeed) external {
        uint256 n = escrow.agreement_count();
        if (n == 0) return;
        vm.prank(agent);
        escrow.cancel_agreement(idSeed % n);
    }

    function refund(uint256 idSeed, uint256 warpSeed) external {
        uint256 n = escrow.agreement_count();
        if (n == 0) return;
        vm.warp(block.timestamp + bound(warpSeed, 0, 40 days));
        vm.prank(client);
        escrow.refund_after_timeout(idSeed % n);
    }

    function togglePause(bool pauseIt) external {
        vm.prank(agent);
        if (pauseIt) escrow.pause();
        else escrow.unpause();
    }
}

contract TalentAgentQuaiInvariantTest is Test {
    ITestToken token;
    ITalentAgentQuai escrow;
    EscrowHandler handler;

    address agent = address(0xA6E27);
    address talent = address(0x7A1E37);
    address feeRecipient = address(0xFEE);
    address client = address(0xC11E47);

    function setUp() public {
        token = ITestToken(vm.deployCode("test-artifacts/TestSettlementToken.json"));
        vm.prank(agent);
        escrow = ITalentAgentQuai(
            vm.deployCode("test-artifacts/TalentAgentQuai.json", abi.encode(address(token), feeRecipient, 250))
        );
        handler = new EscrowHandler(escrow, token, agent, client, talent);
        targetContract(address(handler));
    }

    /// I1: the escrow's token balance always equals the sum of
    /// (deposited - paid_out) over OPEN (funded) agreements.
    function invariant_balanceCoversOpenAgreements() public view {
        uint256 sum;
        for (uint256 i = 0; i < escrow.agreement_count(); i++) {
            (, , , , uint256 deposited, uint256 paidOut, uint256 status, , ) = escrow.get_agreement(i);
            if (status == 1) sum += deposited - paidOut;
        }
        assertEq(token.balanceOf(address(escrow)), sum);
    }

    /// I2: no agreement ever pays out more than was deposited.
    function invariant_neverOverpaid() public view {
        for (uint256 i = 0; i < escrow.agreement_count(); i++) {
            (, , , uint256 total, uint256 deposited, uint256 paidOut, uint256 status, , ) = escrow.get_agreement(i);
            assertLe(paidOut, deposited);
            if (status == 1 || status == 2) assertEq(deposited, total);
        }
    }
}
