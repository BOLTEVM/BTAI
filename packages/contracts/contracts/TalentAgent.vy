# @version ^0.3.7

# BTAI Talent Agent Smart Contract
# Manages talent-client agreements and escrowed payments via ERC20 (USDC).

interface ERC20:
    def transfer(_to: address, _value: uint256) -> bool: nonpayable
    def transferFrom(_from: address, _to: address, _value: uint256) -> bool: nonpayable

event AgreementCreated:
    agreement_id: uint256
    talent: indexed(address)
    client: indexed(address)
    amount: uint256

event FundsDeposited:
    agreement_id: uint256
    amount: uint256

event PayoutTriggered:
    agreement_id: uint256
    amount: uint256

event AgreementCancelled:
    agreement_id: uint256

struct Agreement:
    talent: address
    client: address
    token: address
    amount: uint256
    deposited: uint256
    paid_out: uint256
    status: uint256 # 0: Created, 1: Funded, 2: Completed, 3: Cancelled

agent: public(address)
agreement_count: public(uint256)
agreements: public(HashMap[uint256, Agreement])

@external
def __init__():
    self.agent = msg.sender

@external
def create_agreement(talent: address, token: address, amount: uint256) -> uint256:
    # Only BTAI Orchestrator or the Talent can initialize the escrow
    assert msg.sender == self.agent or msg.sender == talent, "Unauthorized"
    assert talent != empty(address), "Invalid talent"
    assert token != empty(address), "Invalid token"
    assert amount > 0, "Amount must be greater than zero"

    id: uint256 = self.agreement_count
    self.agreements[id] = Agreement({
        talent: talent,
        client: empty(address),
        token: token,
        amount: amount,
        deposited: 0,
        paid_out: 0,
        status: 0
    })
    
    self.agreement_count += 1
    log AgreementCreated(id, talent, empty(address), amount)
    return id

@external
@nonreentrant("lock")
def deposit(agreement_id: uint256):
    ag: Agreement = self.agreements[agreement_id]
    assert ag.status == 0, "Agreement already funded or closed"

    # Effects first (CEI): mark the agreement funded BEFORE pulling tokens, so a
    # malicious/reentrant token callback cannot re-enter deposit() with status
    # still 0 and pull the escrow amount more than once.
    ag.client = msg.sender
    ag.deposited = ag.amount
    ag.status = 1 # Funded
    self.agreements[agreement_id] = ag

    # Interaction: x402 Input — fulfilling the "Payment Required" challenge.
    # Require a truthy return so non-reverting-on-failure ERC20s cannot spoof success.
    assert ERC20(ag.token).transferFrom(msg.sender, self, ag.amount), "transferFrom failed"

    log FundsDeposited(agreement_id, ag.amount)

@external
@nonreentrant("lock")
def create_and_deposit(talent: address, token: address, amount: uint256) -> uint256:
    # x402 Input, single call: the client opens AND funds the escrow atomically.
    #
    # The two-step create_agreement/deposit path is orchestrator-initiated and
    # gated on the agent or the talent, so a client cannot drive it themselves.
    # It also leaves a created-but-unfunded agreement that any address can claim
    # by depositing first. This entry point is client-initiated by construction:
    # the caller is recorded as the client and their funds land in the same
    # transaction, so neither gap exists.
    assert talent != empty(address), "Invalid talent"
    assert token != empty(address), "Invalid token"
    assert amount > 0, "Amount must be greater than zero"

    id: uint256 = self.agreement_count

    # Effects first (CEI): the agreement is fully written and counted before the
    # token is touched, so a reentrant token callback sees consistent state.
    self.agreements[id] = Agreement({
        talent: talent,
        client: msg.sender,
        token: token,
        amount: amount,
        deposited: amount,
        paid_out: 0,
        status: 1 # Funded
    })
    self.agreement_count += 1

    # Interaction: pull the escrowed amount. Require a truthy return so
    # non-reverting-on-failure ERC20s cannot spoof success.
    assert ERC20(token).transferFrom(msg.sender, self, amount), "transferFrom failed"

    log AgreementCreated(id, talent, msg.sender, amount)
    log FundsDeposited(id, amount)
    return id

@external
@nonreentrant("lock")
def release_funds(agreement_id: uint256, amount: uint256):
    # Only the BTAI Orchestrator or the Client can release funds
    ag: Agreement = self.agreements[agreement_id]
    assert msg.sender == self.agent or msg.sender == ag.client, "Unauthorized"
    assert ag.status == 1, "Agreement not in funded state"
    assert ag.paid_out + amount <= ag.deposited, "Release amount exceeds deposit"

    # Effects first (CEI): update accounting before the external transfer.
    ag.paid_out += amount
    if ag.paid_out == ag.deposited:
        ag.status = 2 # Completed
    self.agreements[agreement_id] = ag

    # Interaction: x402 Output — settling the payout.
    assert ERC20(ag.token).transfer(ag.talent, amount), "transfer failed"

    log PayoutTriggered(agreement_id, amount)

@external
@nonreentrant("lock")
def cancel_agreement(agreement_id: uint256):
    # Only the agent can cancel and refund if needed
    assert msg.sender == self.agent, "Only Agent can cancel"
    ag: Agreement = self.agreements[agreement_id]
    assert ag.status == 1, "Nothing to cancel/refund"

    remaining: uint256 = ag.deposited - ag.paid_out

    # Effects first (CEI): close the agreement before refunding.
    ag.status = 3 # Cancelled
    self.agreements[agreement_id] = ag

    # Interaction: refund remaining balance to client.
    if remaining > 0:
        assert ERC20(ag.token).transfer(ag.client, remaining), "refund failed"

    log AgreementCancelled(agreement_id)

@external
def set_agent(new_agent: address):
    assert msg.sender == self.agent, "Only current Agent can set new one"
    self.agent = new_agent
