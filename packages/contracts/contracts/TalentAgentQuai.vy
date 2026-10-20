# @version ^0.3.7

# BTAI Talent Agent — QUAI Network escrow contract.
#
# Evolution of TalentAgent.vy for the QUAI x402 talent agency:
#   - Settlement-token allowlist (no arbitrary/malicious ERC-20 callbacks).
#   - Milestone-scoped releases instead of a single lump-sum payout.
#   - Protocol fee in basis points, capped, with a dedicated recipient.
#   - Two-step agent (orchestrator) transfer: propose -> accept.
#   - Dispute window: after funded_at + dispute_window the client can reclaim
#     the unreleased remainder without the agent.
#   - Pause blocks new deposits ONLY — releases, cancels, and refunds can never
#     be paused, so a pause can never trap client funds.
#
# Security invariants (fuzz-tested in test/TalentAgentQuai.test.js):
#   I1: token balance of this contract == sum over open agreements of
#       (deposited - paid_out).
#   I2: for every agreement: talent_received + fee_received + refundable
#       == deposited.
#   I3: paused == True never blocks release_milestone / cancel_agreement /
#       refund_after_timeout.
#
# Compile for QUAI with evm_version=paris (QUAI's EVM ceiling is London-class;
# Shanghai+ opcodes such as PUSH0 must not appear in the deployed bytecode).

interface ERC20:
    def transfer(_to: address, _value: uint256) -> bool: nonpayable
    def transferFrom(_from: address, _to: address, _value: uint256) -> bool: nonpayable

# Status codes
# 0: Created (unfunded)   1: Funded   2: Completed   3: Cancelled   4: Refunded (timeout)

MAX_MILESTONES: constant(uint256) = 32
BPS_DENOMINATOR: constant(uint256) = 10000
MAX_FEE_BPS: constant(uint256) = 1000          # hard cap: 10%
MIN_DISPUTE_WINDOW: constant(uint256) = 259200 # 3 days
MAX_DISPUTE_WINDOW: constant(uint256) = 2592000 # 30 days

# EIP-712 constants for the gasless x402 settlement path. Precomputed offline
# (keccak256 over the type strings below) and pinned as constants so no hashing
# is needed at deploy time:
#   "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
#   "EscrowAuthorization(address client,address talent,address token,uint256 total,uint256 disputeWindow,uint256 validBefore,bytes32 nonce)"
#   name = "BTAI Talent Agency", version = "1"
DOMAIN_TYPEHASH: constant(bytes32) = 0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f
AUTH_TYPEHASH: constant(bytes32) = 0x8a7234c8fe78c76155f46adc8f44f2def476c3f525c1c9b622af2dbd64f21a66
NAME_HASH: constant(bytes32) = 0xb28c3bfc85e7fa5a4520076373df4db5a11bd824871df9824110f4aef11a7dfc
VERSION_HASH: constant(bytes32) = 0xc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6

struct Milestone:
    amount: uint256
    released: bool

struct Agreement:
    talent: address
    client: address
    token: address
    milestones: DynArray[Milestone, MAX_MILESTONES]
    deposited: uint256
    paid_out: uint256
    status: uint256
    funded_at: uint256
    dispute_window: uint256

event AgreementCreated:
    agreement_id: uint256
    talent: indexed(address)
    client: indexed(address)
    total: uint256
    milestone_count: uint256

event FundsDeposited:
    agreement_id: uint256
    amount: uint256

event MilestoneReleased:
    agreement_id: uint256
    milestone_index: uint256
    talent_amount: uint256
    fee_amount: uint256

event AgreementCancelled:
    agreement_id: uint256

event AgreementRefunded:
    agreement_id: uint256
    amount: uint256

event TokenAllowanceUpdated:
    token: indexed(address)
    allowed: bool

event AgentTransferProposed:
    current_agent: indexed(address)
    pending_agent: indexed(address)

event AgentTransferred:
    previous_agent: indexed(address)
    new_agent: indexed(address)

event FeeUpdated:
    fee_bps: uint256
    fee_recipient: address

event Paused:
    by: indexed(address)

event Unpaused:
    by: indexed(address)

event AuthorizationUsed:
    client: indexed(address)
    nonce: indexed(bytes32)
    agreement_id: uint256

event AuthorizationCancelled:
    client: indexed(address)
    nonce: indexed(bytes32)

agent: public(address)
pending_agent: public(address)
fee_bps: public(uint256)
fee_recipient: public(address)
paused: public(bool)
allowed_tokens: public(HashMap[address, bool])
domain_separator: public(bytes32)
authorization_used: public(HashMap[address, HashMap[bytes32, bool]])
agreement_count: public(uint256)
agreements: HashMap[uint256, Agreement]

@external
def __init__(settlement_token: address, _fee_recipient: address, _fee_bps: uint256):
    assert settlement_token != empty(address), "Invalid settlement token"
    assert _fee_bps <= MAX_FEE_BPS, "Fee exceeds cap"
    if _fee_bps > 0:
        assert _fee_recipient != empty(address), "Fee recipient required"
    self.agent = msg.sender
    self.allowed_tokens[settlement_token] = True
    self.fee_bps = _fee_bps
    self.fee_recipient = _fee_recipient
    self.domain_separator = keccak256(concat(
        DOMAIN_TYPEHASH,
        NAME_HASH,
        VERSION_HASH,
        convert(chain.id, bytes32),
        convert(self, bytes32),
    ))
    log TokenAllowanceUpdated(settlement_token, True)
    log FeeUpdated(_fee_bps, _fee_recipient)

# --------------------------------------------------------------------------
# Internal helpers
# --------------------------------------------------------------------------

@internal
@view
def _total_of(milestones: DynArray[Milestone, MAX_MILESTONES]) -> uint256:
    total: uint256 = 0
    for m in milestones:
        total += m.amount
    return total

@internal
def _write_new_agreement(
    talent: address,
    client: address,
    token: address,
    amounts: DynArray[uint256, MAX_MILESTONES],
    dispute_window: uint256,
    funded: bool,
) -> uint256:
    assert talent != empty(address), "Invalid talent"
    assert self.allowed_tokens[token], "Token not allowlisted"
    assert len(amounts) > 0, "No milestones"

    milestones: DynArray[Milestone, MAX_MILESTONES] = []
    total: uint256 = 0
    for amount in amounts:
        assert amount > 0, "Milestone amount must be greater than zero"
        milestones.append(Milestone({amount: amount, released: False}))
        total += amount

    id: uint256 = self.agreement_count
    self.agreements[id] = Agreement({
        talent: talent,
        client: client,
        token: token,
        milestones: milestones,
        deposited: total if funded else 0,
        paid_out: 0,
        status: 1 if funded else 0,
        funded_at: block.timestamp if funded else 0,
        dispute_window: dispute_window,
    })
    self.agreement_count += 1
    return id

# --------------------------------------------------------------------------
# Admin
# --------------------------------------------------------------------------

@external
def set_token_allowed(token: address, allowed: bool):
    assert msg.sender == self.agent, "Only agent"
    assert token != empty(address), "Invalid token"
    self.allowed_tokens[token] = allowed
    log TokenAllowanceUpdated(token, allowed)

@external
def propose_agent(new_agent: address):
    # Two-step transfer: the new agent must accept, so a typo cannot brick the
    # orchestrator role.
    assert msg.sender == self.agent, "Only agent"
    assert new_agent != empty(address), "Invalid agent"
    self.pending_agent = new_agent
    log AgentTransferProposed(self.agent, new_agent)

@external
def accept_agent():
    assert msg.sender == self.pending_agent, "Only pending agent"
    previous: address = self.agent
    self.agent = msg.sender
    self.pending_agent = empty(address)
    log AgentTransferred(previous, msg.sender)

@external
def set_fee(_fee_bps: uint256, _fee_recipient: address):
    assert msg.sender == self.agent, "Only agent"
    assert _fee_bps <= MAX_FEE_BPS, "Fee exceeds cap"
    if _fee_bps > 0:
        assert _fee_recipient != empty(address), "Fee recipient required"
    self.fee_bps = _fee_bps
    self.fee_recipient = _fee_recipient
    log FeeUpdated(_fee_bps, _fee_recipient)

@external
def pause():
    # Blocks NEW deposits only. Releases, cancels and refunds stay live, so a
    # pause can never trap escrowed funds (invariant I3).
    assert msg.sender == self.agent, "Only agent"
    self.paused = True
    log Paused(msg.sender)

@external
def unpause():
    assert msg.sender == self.agent, "Only agent"
    self.paused = False
    log Unpaused(msg.sender)

# --------------------------------------------------------------------------
# Agreement lifecycle
# --------------------------------------------------------------------------

@external
def create_agreement(
    talent: address,
    token: address,
    amounts: DynArray[uint256, MAX_MILESTONES],
    dispute_window: uint256,
) -> uint256:
    # Orchestrator-initiated path: only the BTAI agent or the talent may open
    # an unfunded agreement for a client to deposit into later.
    assert msg.sender == self.agent or msg.sender == talent, "Unauthorized"
    assert dispute_window >= MIN_DISPUTE_WINDOW and dispute_window <= MAX_DISPUTE_WINDOW, "Dispute window out of bounds"
    id: uint256 = self._write_new_agreement(talent, empty(address), token, amounts, dispute_window, False)
    log AgreementCreated(id, talent, empty(address), self._total_of(self.agreements[id].milestones), len(amounts))
    return id

@external
@nonreentrant("lock")
def deposit(agreement_id: uint256):
    assert not self.paused, "Deposits paused"
    ag: Agreement = self.agreements[agreement_id]
    assert ag.status == 0, "Agreement already funded or closed"

    total: uint256 = self._total_of(ag.milestones)

    # Effects first (CEI): mark funded BEFORE pulling tokens, so a reentrant
    # token callback sees consistent state and cannot pull the amount twice.
    ag.client = msg.sender
    ag.deposited = total
    ag.status = 1
    ag.funded_at = block.timestamp
    self.agreements[agreement_id] = ag

    # Interaction: x402 input — fulfilling the payment challenge. Require a
    # truthy return so non-reverting-on-failure tokens cannot spoof success.
    assert ERC20(ag.token).transferFrom(msg.sender, self, total), "transferFrom failed"

    log FundsDeposited(agreement_id, total)

@external
@nonreentrant("lock")
def create_and_deposit(
    talent: address,
    token: address,
    amounts: DynArray[uint256, MAX_MILESTONES],
    dispute_window: uint256,
) -> uint256:
    # x402 input, single call: the client opens AND funds the escrow atomically.
    # The caller is recorded as the client and their funds land in the same
    # transaction, so there is no created-but-unfunded agreement for anyone
    # else to claim.
    assert not self.paused, "Deposits paused"
    assert dispute_window >= MIN_DISPUTE_WINDOW and dispute_window <= MAX_DISPUTE_WINDOW, "Dispute window out of bounds"

    # Effects first (CEI): the agreement is fully written and counted before
    # the token is touched, so a reentrant token callback sees consistent state.
    id: uint256 = self._write_new_agreement(talent, msg.sender, token, amounts, dispute_window, True)
    total: uint256 = self.agreements[id].deposited

    # Interaction: pull the escrowed amount. Truthy return required.
    assert ERC20(token).transferFrom(msg.sender, self, total), "transferFrom failed"

    log AgreementCreated(id, talent, msg.sender, total, len(amounts))
    log FundsDeposited(id, total)
    return id

@external
@nonreentrant("lock")
def release_milestone(agreement_id: uint256, milestone_index: uint256):
    # Only the BTAI agent or the client can release a milestone to the talent.
    # Never blocked by pause: escrowed funds must always be able to move forward.
    ag: Agreement = self.agreements[agreement_id]
    assert msg.sender == self.agent or msg.sender == ag.client, "Unauthorized"
    assert ag.status == 1, "Agreement not in funded state"
    assert milestone_index < len(ag.milestones), "Invalid milestone"

    milestone: Milestone = ag.milestones[milestone_index]
    assert not milestone.released, "Milestone already released"

    fee_amount: uint256 = milestone.amount * self.fee_bps / BPS_DENOMINATOR
    talent_amount: uint256 = milestone.amount - fee_amount

    # Effects first (CEI): accounting settled before any external call.
    milestone.released = True
    ag.milestones[milestone_index] = milestone
    ag.paid_out += milestone.amount
    if ag.paid_out == ag.deposited:
        ag.status = 2 # Completed
    self.agreements[agreement_id] = ag

    # Interactions: x402 output — settling the payout (and the protocol fee).
    assert ERC20(ag.token).transfer(ag.talent, talent_amount), "transfer failed"
    if fee_amount > 0:
        assert ERC20(ag.token).transfer(self.fee_recipient, fee_amount), "fee transfer failed"

    log MilestoneReleased(agreement_id, milestone_index, talent_amount, fee_amount)

@external
@nonreentrant("lock")
def create_and_deposit_for(
    client: address,
    talent: address,
    token: address,
    amounts: DynArray[uint256, MAX_MILESTONES],
    dispute_window: uint256,
    valid_before: uint256,
    nonce: bytes32,
    v: uint256,
    r: uint256,
    s: uint256,
) -> uint256:
    # Gasless x402 settlement (EIP-3009-style, receive-variant): the client
    # signs an EscrowAuthorization off-chain and the facilitator (the agent
    # key) submits it on-chain, paying the gas. Only the agent may submit —
    # this is the receiveWithAuthorization pattern, which prevents third
    # parties from front-running a signed authorization into the escrow.
    assert msg.sender == self.agent, "Only agent"
    assert not self.paused, "Deposits paused"
    assert block.timestamp <= valid_before, "Authorization expired"
    assert not self.authorization_used[client][nonce], "Authorization already used"
    assert dispute_window >= MIN_DISPUTE_WINDOW and dispute_window <= MAX_DISPUTE_WINDOW, "Dispute window out of bounds"

    # Verify the EIP-712 signature BEFORE any state change or external call.
    # The total signed is checked against the milestone sum below, so the
    # client always authorizes exactly what is pulled.
    total: uint256 = 0
    for amount in amounts:
        total += amount
    struct_hash: bytes32 = keccak256(concat(
        AUTH_TYPEHASH,
        convert(client, bytes32),
        convert(talent, bytes32),
        convert(token, bytes32),
        convert(total, bytes32),
        convert(dispute_window, bytes32),
        convert(valid_before, bytes32),
        nonce,
    ))
    digest: bytes32 = keccak256(concat(b"\x19\x01", self.domain_separator, struct_hash))
    signer: address = ecrecover(digest, v, r, s)
    assert signer != empty(address), "Invalid signature"
    assert signer == client, "Invalid authorization signature"

    # Effects first (CEI): burn the nonce and write the funded agreement
    # before the token is touched, so a reentrant token callback sees
    # consistent state and the authorization cannot be replayed.
    self.authorization_used[client][nonce] = True
    id: uint256 = self._write_new_agreement(talent, client, token, amounts, dispute_window, True)
    assert self.agreements[id].deposited == total, "Signed total mismatch"

    # Interaction: pull the escrowed amount. The client must have approved
    # this contract beforehand; truthy return required.
    assert ERC20(token).transferFrom(client, self, total), "transferFrom failed"

    log AuthorizationUsed(client, nonce, id)
    log AgreementCreated(id, talent, client, total, len(amounts))
    log FundsDeposited(id, total)
    return id

@external
def cancel_authorization(nonce: bytes32):
    # Escape hatch: burn one of the caller's unused signed authorizations
    # before it expires.
    assert not self.authorization_used[msg.sender][nonce], "Authorization already used"
    self.authorization_used[msg.sender][nonce] = True
    log AuthorizationCancelled(msg.sender, nonce)

@external
@nonreentrant("lock")
def cancel_agreement(agreement_id: uint256):
    # Agent arbitration: cancel and refund the unreleased remainder to the
    # client. Never blocked by pause.
    assert msg.sender == self.agent, "Only agent can cancel"
    ag: Agreement = self.agreements[agreement_id]
    assert ag.status == 1, "Nothing to cancel/refund"

    remaining: uint256 = ag.deposited - ag.paid_out

    # Effects first (CEI): close the agreement before refunding.
    ag.status = 3 # Cancelled
    self.agreements[agreement_id] = ag

    # Interaction: refund remaining balance to the client.
    if remaining > 0:
        assert ERC20(ag.token).transfer(ag.client, remaining), "refund failed"

    log AgreementCancelled(agreement_id)

@external
@nonreentrant("lock")
def refund_after_timeout(agreement_id: uint256):
    # Dispute timeout: once the dispute window has elapsed with milestones still
    # unreleased, the client may reclaim the remainder without the agent. Never
    # blocked by pause.
    ag: Agreement = self.agreements[agreement_id]
    assert msg.sender == ag.client, "Only client"
    assert ag.status == 1, "Nothing to refund"
    assert block.timestamp >= ag.funded_at + ag.dispute_window, "Dispute window still open"

    remaining: uint256 = ag.deposited - ag.paid_out

    # Effects first (CEI): close the agreement before refunding.
    ag.status = 4 # Refunded
    self.agreements[agreement_id] = ag

    if remaining > 0:
        assert ERC20(ag.token).transfer(ag.client, remaining), "refund failed"

    log AgreementRefunded(agreement_id, remaining)

# --------------------------------------------------------------------------
# Views (explicit getters: the agreement struct holds a DynArray, so the
# automatic public getter is intentionally not generated)
# --------------------------------------------------------------------------

@external
@view
def get_agreement(agreement_id: uint256) -> (address, address, address, uint256, uint256, uint256, uint256, uint256, uint256):
    ag: Agreement = self.agreements[agreement_id]
    return (
        ag.talent,
        ag.client,
        ag.token,
        self._total_of(ag.milestones),
        ag.deposited,
        ag.paid_out,
        ag.status,
        ag.funded_at,
        ag.dispute_window,
    )

@external
@view
def get_milestone(agreement_id: uint256, milestone_index: uint256) -> (uint256, bool):
    m: Milestone = self.agreements[agreement_id].milestones[milestone_index]
    return (m.amount, m.released)

@external
@view
def get_milestone_count(agreement_id: uint256) -> uint256:
    return len(self.agreements[agreement_id].milestones)
