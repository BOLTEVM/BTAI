# @version ^0.3.7

# AI Talent Agent Smart Contract
# Manages talent-client agreements and escrowed payments.

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
def create_agreement(talent: address, amount: uint256) -> uint256:
    # The client or talent can create the agreement
    # Usually the agent creates it after matching
    assert msg.sender == self.agent or msg.sender == talent, "Unauthorized"
    
    id: uint256 = self.agreement_count
    self.agreements[id] = Agreement({
        talent: talent,
        client: empty(address), # Set during deposit
        amount: amount,
        deposited: 0,
        paid_out: 0,
        status: 0
    })
    
    self.agreement_count += 1
    log AgreementCreated(id, talent, empty(address), amount)
    return id

@external
@payable
def deposit(agreement_id: uint256):
    ag: Agreement = self.agreements[agreement_id]
    assert ag.status == 0, "Agreement already funded or closed"
    assert msg.value == ag.amount, "Incorrect deposit amount"
    
    ag.client = msg.sender
    ag.deposited = msg.value
    ag.status = 1 # Funded
    self.agreements[agreement_id] = ag
    
    log FundsDeposited(agreement_id, msg.value)

@external
def release_funds(agreement_id: uint256, amount: uint256):
    # Only the AI Agent or the Client can release funds
    ag: Agreement = self.agreements[agreement_id]
    assert msg.sender == self.agent or msg.sender == ag.client, "Unauthorized"
    assert ag.status == 1, "Agreement not in funded state"
    assert ag.paid_out + amount <= ag.deposited, "Release amount exceeds deposit"
    
    send(ag.talent, amount)
    ag.paid_out += amount
    
    if ag.paid_out == ag.deposited:
        ag.status = 2 # Completed
        
    self.agreements[agreement_id] = ag
    log PayoutTriggered(agreement_id, amount)

@external
def cancel_agreement(agreement_id: uint256):
    # Only the agent can cancel and refund if needed
    assert msg.sender == self.agent, "Only Agent can cancel"
    ag: Agreement = self.agreements[agreement_id]
    assert ag.status == 1, "Nothing to cancel/refund"
    
    # Refund balance to client
    remaining: uint256 = ag.deposited - ag.paid_out
    if remaining > 0:
        send(ag.client, remaining)
    
    ag.status = 3 # Cancelled
    self.agreements[agreement_id] = ag
    log AgreementCancelled(agreement_id)

@external
def set_agent(new_agent: address):
    assert msg.sender == self.agent, "Only current Agent can set new one"
    self.agent = new_agent
