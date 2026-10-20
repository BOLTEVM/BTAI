// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";

/// @dev Minimal ERC-20 surface of TestSettlementToken (mintable, 6 decimals).
interface ITestToken {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev External surface of TalentAgentQuai.vy (deployed from its Vyper
/// bytecode artifact, so these tests exercise exactly what ships on QUAI).
interface ITalentAgentQuai {
    function create_and_deposit(address talent, address token, uint256[] calldata amounts, uint256 disputeWindow)
        external
        returns (uint256);
    function create_and_deposit_for(
        address client,
        address talent,
        address token,
        uint256[] calldata amounts,
        uint256 disputeWindow,
        uint256 validBefore,
        bytes32 nonce,
        uint256 v,
        uint256 r,
        uint256 s
    ) external returns (uint256);
    function release_milestone(uint256 agreementId, uint256 milestoneIndex) external;
    function cancel_agreement(uint256 agreementId) external;
    function refund_after_timeout(uint256 agreementId) external;
    function cancel_authorization(bytes32 nonce) external;
    function pause() external;
    function unpause() external;
    function set_token_allowed(address token, bool allowed) external;
    function set_fee(uint256 feeBps, address feeRecipient) external;

    function agent() external view returns (address);
    function fee_bps() external view returns (uint256);
    function fee_recipient() external view returns (address);
    function paused() external view returns (bool);
    function allowed_tokens(address token) external view returns (bool);
    function domain_separator() external view returns (bytes32);
    function authorization_used(address client, bytes32 nonce) external view returns (bool);
    function agreement_count() external view returns (uint256);
    function get_agreement(uint256 agreementId)
        external
        view
        returns (
            address talent,
            address client,
            address token,
            uint256 total,
            uint256 deposited,
            uint256 paidOut,
            uint256 status,
            uint256 fundedAt,
            uint256 disputeWindow
        );
    function get_milestone(uint256 agreementId, uint256 milestoneIndex) external view returns (uint256, bool);
    function get_milestone_count(uint256 agreementId) external view returns (uint256);
}

contract TalentAgentQuaiTest is Test {
    // EIP-712 constants pinned in the Vyper source.
    bytes32 constant DOMAIN_TYPEHASH = 0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f;
    bytes32 constant AUTH_TYPEHASH = 0x8a7234c8fe78c76155f46adc8f44f2def476c3f525c1c9b622af2dbd64f21a66;
    bytes32 constant NAME_HASH = 0xb28c3bfc85e7fa5a4520076373df4db5a11bd824871df9824110f4aef11a7dfc;
    bytes32 constant VERSION_HASH = 0xc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6;

    uint256 constant BPS = 10_000;
    uint256 constant MIN_WINDOW = 259200; // 3 days
    uint256 constant MAX_WINDOW = 2592000; // 30 days
    uint256 constant CLIENT_KEY = 0xA11CE;

    ITestToken token;
    ITalentAgentQuai escrow;

    address agent = address(0xA6E27);
    address talent = address(0x7A1E37);
    address feeRecipient = address(0xFEE);
    address client;

    function setUp() public {
        token = ITestToken(vm.deployCode("test-artifacts/TestSettlementToken.json"));
        client = vm.addr(CLIENT_KEY);
    }

    /// @dev Deploys the escrow from the compiled Vyper artifact with a fuzzed fee.
    function deployEscrow(uint256 feeBps) internal returns (ITalentAgentQuai) {
        vm.prank(agent);
        return ITalentAgentQuai(
            vm.deployCode("test-artifacts/TalentAgentQuai.json", abi.encode(address(token), feeRecipient, feeBps))
        );
    }

    function fund(address who, uint256 amount, address escrowAddr) internal {
        token.mint(who, amount);
        vm.prank(who);
        token.approve(escrowAddr, amount);
    }

    /// @dev Splits `total` into `count` positive milestone amounts.
    function split(uint256 total, uint256 count) internal pure returns (uint256[] memory amounts) {
        amounts = new uint256[](count);
        uint256 base = total / count;
        uint256 remainder = total - base * count;
        for (uint256 i = 0; i < count; i++) {
            amounts[i] = base + (i == count - 1 ? remainder : 0);
        }
    }

    function signAuth(
        ITalentAgentQuai target,
        uint256 signerKey,
        address signerClient,
        uint256 total,
        uint256 disputeWindow,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (uint256 v, uint256 r, bytes32 sBytes) {
        bytes32 structHash = keccak256(
            abi.encode(
                AUTH_TYPEHASH, signerClient, talent, address(token), total, disputeWindow, validBefore, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", target.domain_separator(), structHash));
        bytes32 rBytes;
        (v, rBytes, sBytes) = vm.sign(signerKey, digest);
        return (v, uint256(rBytes), sBytes);
    }

    // ------------------------------------------------------------------
    // Domain separator sanity
    // ------------------------------------------------------------------

    function testDomainSeparatorMatchesSpec() public {
        escrow = deployEscrow(250);
        bytes32 expected = keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(escrow))
        );
        assertEq(escrow.domain_separator(), expected);
        assertEq(escrow.agent(), agent);
        assertTrue(escrow.allowed_tokens(address(token)));
    }

    // ------------------------------------------------------------------
    // Fuzz: fee split exactness across full milestone release
    // ------------------------------------------------------------------

    function testFuzz_feeSplitExactness(uint256 total, uint256 feeBps, uint8 milestoneSeed) public {
        uint256 count = bound(milestoneSeed, 1, 8);
        feeBps = bound(feeBps, 0, 1000);
        total = bound(total, count, 1e12); // every milestone must be >= 1

        escrow = deployEscrow(feeBps);
        fund(client, total, address(escrow));

        uint256[] memory amounts = split(total, count);
        vm.prank(client);
        uint256 id = escrow.create_and_deposit(talent, address(token), amounts, MIN_WINDOW);

        uint256 expectedFees;
        for (uint256 i = 0; i < count; i++) {
            vm.prank(agent);
            escrow.release_milestone(id, i);
            expectedFees += (amounts[i] * feeBps) / BPS;
        }

        // I2: talent + fee == deposited, exactly.
        assertEq(token.balanceOf(talent), total - expectedFees);
        assertEq(token.balanceOf(feeRecipient), expectedFees);
        // I1: nothing stranded in the escrow.
        assertEq(token.balanceOf(address(escrow)), 0);
        // Status Completed once fully released.
        (, , , , , , uint256 status, , ) = escrow.get_agreement(id);
        assertEq(status, 2);
    }

    // ------------------------------------------------------------------
    // Fuzz: dispute-window timeout boundary
    // ------------------------------------------------------------------

    function testFuzz_refundAfterTimeoutBoundary(uint256 window, uint256 elapsed) public {
        window = bound(window, MIN_WINDOW, MAX_WINDOW);
        escrow = deployEscrow(250);
        uint256 total = 500e6;
        fund(client, total, address(escrow));

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = total;
        vm.prank(client);
        uint256 id = escrow.create_and_deposit(talent, address(token), amounts, window);

        (, , , , , , , uint256 fundedAt, ) = escrow.get_agreement(id);
        elapsed = bound(elapsed, 0, window * 2);
        vm.warp(fundedAt + elapsed);

        vm.prank(client);
        if (elapsed < window) {
            vm.expectRevert();
            escrow.refund_after_timeout(id);
        } else {
            escrow.refund_after_timeout(id);
            assertEq(token.balanceOf(client), total);
            assertEq(token.balanceOf(address(escrow)), 0);
            (, , , , , , uint256 status, , ) = escrow.get_agreement(id);
            assertEq(status, 4);
        }
    }

    // ------------------------------------------------------------------
    // Fuzz: pause never traps funds
    // ------------------------------------------------------------------

    function testFuzz_pauseNeverTrapsFunds(uint256 total, bool releaseFirst) public {
        total = bound(total, 2, 1e12);
        escrow = deployEscrow(100);
        fund(client, total, address(escrow));

        uint256[] memory amounts = split(total, 2);
        vm.prank(client);
        uint256 id = escrow.create_and_deposit(talent, address(token), amounts, MIN_WINDOW);

        vm.prank(agent);
        escrow.pause();

        // New deposits are blocked while paused.
        fund(client, total, address(escrow));
        vm.prank(client);
        vm.expectRevert();
        escrow.create_and_deposit(talent, address(token), amounts, MIN_WINDOW);

        // Releases still work while paused.
        if (releaseFirst) {
            vm.prank(agent);
            escrow.release_milestone(id, 0);
        }

        // Refund after timeout still works while paused.
        vm.warp(block.timestamp + MIN_WINDOW);
        vm.prank(client);
        escrow.refund_after_timeout(id);

        uint256 paid = releaseFirst ? amounts[0] : 0;
        uint256 fee = (amounts[0] * 100) / BPS;
        // The client was funded twice (the second deposit reverted while
        // paused, leaving its minted tokens untouched), then refunded the
        // unreleased remainder: 2*total - paid.
        assertEq(token.balanceOf(client), 2 * total - paid);
        if (releaseFirst) {
            assertEq(token.balanceOf(talent), paid - fee);
            assertEq(token.balanceOf(feeRecipient), fee);
        }
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    // ------------------------------------------------------------------
    // Fuzz: gasless EIP-712 settlement (the x402 path)
    // ------------------------------------------------------------------

    function testFuzz_gaslessSettlement(uint256 total, uint256 windowSeed) public {
        total = bound(total, 2, 1e12);
        uint256 window = bound(windowSeed, MIN_WINDOW, MAX_WINDOW);
        escrow = deployEscrow(250);
        fund(client, total, address(escrow));

        bytes32 nonce = keccak256("auth-1");
        uint256 validBefore = block.timestamp + 300;
        (uint256 v, uint256 r, bytes32 s) = signAuth(escrow, CLIENT_KEY, client, total, window, validBefore, nonce);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = total;

        // Only the agent key may submit a signed authorization.
        vm.expectRevert();
        escrow.create_and_deposit_for(client, talent, address(token), amounts, window, validBefore, nonce, v, r, uint256(s));

        vm.prank(agent);
        uint256 id = escrow.create_and_deposit_for(
            client, talent, address(token), amounts, window, validBefore, nonce, v, r, uint256(s)
        );

        assertTrue(escrow.authorization_used(client, nonce));
        (, address storedClient, , , uint256 deposited, , uint256 status, , ) = escrow.get_agreement(id);
        assertEq(storedClient, client);
        assertEq(deposited, total);
        assertEq(status, 1);
        assertEq(token.balanceOf(address(escrow)), total);

        // Replay with the same nonce reverts.
        vm.prank(agent);
        vm.expectRevert();
        escrow.create_and_deposit_for(client, talent, address(token), amounts, window, validBefore, nonce, v, r, uint256(s));
    }

    function testFuzz_gaslessRejectsWrongSigner(uint256 wrongKeySeed, uint256 total) public {
        total = bound(total, 1, 1e12);
        uint256 wrongKey = bound(wrongKeySeed, 1, type(uint128).max);
        vm.assume(wrongKey != CLIENT_KEY);
        // vm.addr would fail for keys outside the curve order range.
        vm.assume(wrongKey < 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141);

        escrow = deployEscrow(250);
        fund(client, total, address(escrow));

        bytes32 nonce = keccak256("auth-2");
        uint256 validBefore = block.timestamp + 300;
        (uint256 v, uint256 r, bytes32 s) = signAuth(escrow, wrongKey, client, total, MIN_WINDOW, validBefore, nonce);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = total;

        vm.prank(agent);
        vm.expectRevert();
        escrow.create_and_deposit_for(client, talent, address(token), amounts, MIN_WINDOW, validBefore, nonce, v, r, uint256(s));
    }

    function testGaslessRejectsExpiredAndCancelled() public {
        uint256 total = 100e6;
        escrow = deployEscrow(250);
        fund(client, total, address(escrow));

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = total;

        // Expired authorization.
        bytes32 nonce1 = keccak256("expired");
        uint256 validBefore = block.timestamp + 60;
        (uint256 v, uint256 r, bytes32 s) = signAuth(escrow, CLIENT_KEY, client, total, MIN_WINDOW, validBefore, nonce1);
        vm.warp(validBefore + 1);
        vm.prank(agent);
        vm.expectRevert();
        escrow.create_and_deposit_for(client, talent, address(token), amounts, MIN_WINDOW, validBefore, nonce1, v, r, uint256(s));

        // Client-cancelled authorization.
        bytes32 nonce2 = keccak256("cancelled");
        (v, r, s) = signAuth(escrow, CLIENT_KEY, client, total, MIN_WINDOW, block.timestamp + 300, nonce2);
        vm.prank(client);
        escrow.cancel_authorization(nonce2);
        vm.prank(agent);
        vm.expectRevert();
        escrow.create_and_deposit_for(
            client, talent, address(token), amounts, MIN_WINDOW, block.timestamp + 300, nonce2, v, r, uint256(s)
        );
    }

    // ------------------------------------------------------------------
    // Fuzz: admin guards
    // ------------------------------------------------------------------

    function testFuzz_onlyAgentAdmin(address caller) public {
        vm.assume(caller != agent);
        escrow = deployEscrow(250);

        vm.startPrank(caller);
        vm.expectRevert();
        escrow.pause();
        vm.expectRevert();
        escrow.set_fee(300, feeRecipient);
        vm.expectRevert();
        escrow.set_token_allowed(address(0xBEEF), true);
        vm.stopPrank();
    }

    function testFeeCapEnforced() public {
        vm.prank(agent);
        vm.expectRevert();
        deployWithFee(1001);
    }

    /// @dev Helper so the constructor revert is catchable by expectRevert.
    function deployWithFee(uint256 feeBps) internal returns (ITalentAgentQuai) {
        return ITalentAgentQuai(
            vm.deployCode("test-artifacts/TalentAgentQuai.json", abi.encode(address(token), feeRecipient, feeBps))
        );
    }
}
