// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title TestSettlementToken
 * @notice Minimal 6-decimal ERC-20 used ONLY for local/testnet escrow tests.
 *
 * QUAI has no canonical USDC deployment to fork, so the QUAI escrow suite
 * settles against this pinned, reviewed stand-in instead (the inverse of the
 * Base suite, which forks real USDC because a canonical deployment exists).
 * Deliberately boring: standard return-true semantics, no fees, no callbacks,
 * open minting so tests can fund any account.
 */
contract TestSettlementToken {
    string public constant name = "Test Settlement Token";
    string public constant symbol = "TST";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 value) external returns (bool) {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(balanceOf[from] >= value, "insufficient balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
