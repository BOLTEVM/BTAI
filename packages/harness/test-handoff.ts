import { HandoffOrchestrator } from './src/orchestrator'
import * as assert from 'assert'
import * as fs from 'fs'
import * as path from 'path'

async function runTests() {
  console.log('=== Starting Handoff Orchestrator Test Suite ===')
  const orchestrator = new HandoffOrchestrator(__dirname)

  // Clear previous audit trails to start clean
  const auditPath = path.join(__dirname, 'audit_trail.json')
  if (fs.existsSync(auditPath)) {
    fs.writeFileSync(auditPath, '', 'utf8')
  }

  // Test 1: Complete Happy Path Transition
  console.log('\n--- Test 1: Happy Path Lifecycle ---')
  const task1 = await orchestrator.createTask(
    'TaskOne',
    'ProfitBettingAgent',
    'LiveDjAgent',
    'BtaiGovernor',
    { amount: 100 }
  )
  assert.strictEqual(task1.state, 'PENDING')
  console.log('✔ Task created in PENDING')

  await orchestrator.transitionToActive(task1.id, 'ProfitBettingAgent')
  assert.strictEqual(task1.state, 'ACTIVE')
  console.log('✔ Task transitioned to ACTIVE (Orchestrator Guards passed)')

  await orchestrator.transitionToReady(task1.id, 'LiveDjAgent', { status: 'COMPLETE', logs: 'All done' })
  assert.strictEqual(task1.state, 'READY_FOR_GOVERNOR')
  console.log('✔ Task transitioned to READY_FOR_GOVERNOR (Executor Guards passed)')

  await orchestrator.transitionToCompleted(task1.id, 'BtaiGovernor', 90)
  assert.strictEqual(task1.state, 'COMPLETED')
  assert.strictEqual(task1.score, 90)
  console.log('✔ Task transitioned to COMPLETED (Completion Guards & Scoring Gate passed)')


  // Test 2: Role Separation Enforcement
  console.log('\n--- Test 2: Enforcing Role Separation ---')
  const task2 = await orchestrator.createTask(
    'TaskTwo',
    'ProfitBettingAgent',
    'LiveDjAgent',
    'BtaiGovernor',
    { amount: 200 }
  )

  // Try to start task with wrong actor (LiveDjAgent instead of ProfitBettingAgent)
  try {
    await orchestrator.transitionToActive(task2.id, 'LiveDjAgent')
    assert.fail('Should have thrown error on unauthorized role starting task')
  } catch (err: any) {
    assert.ok(err.message.includes('Role separation failure'))
    console.log('✔ Blocked unauthorized role from starting task')
  }

  // Move task2 to ACTIVE legitimately
  await orchestrator.transitionToActive(task2.id, 'ProfitBettingAgent')

  // Try to submit task2 outputs as ProfitBettingAgent (Orchestrator) instead of LiveDjAgent (Executor)
  try {
    await orchestrator.transitionToReady(task2.id, 'ProfitBettingAgent', { val: 1 })
    assert.fail('Should have thrown error on unauthorized role submitting task')
  } catch (err: any) {
    assert.ok(err.message.includes('Role separation failure'))
    console.log('✔ Blocked unauthorized role from submitting task outputs')
  }

  // Move task2 to READY_FOR_GOVERNOR legitimately
  await orchestrator.transitionToReady(task2.id, 'LiveDjAgent', { val: 1 })

  // Try to approve task2 with wrong governor
  try {
    await orchestrator.transitionToCompleted(task2.id, 'WrongGovernor', 95)
    assert.fail('Should have thrown error on wrong governor approval')
  } catch (err: any) {
    assert.ok(err.message.includes('Role separation failure'))
    console.log('✔ Blocked wrong governor from completing task')
  }


  // Test 3: Block Bad State Transitions (Skipping states)
  console.log('\n--- Test 3: Blocking Bad State Transitions ---')
  const task3 = await orchestrator.createTask(
    'TaskThree',
    'ProfitBettingAgent',
    'LiveDjAgent',
    'BtaiGovernor',
    { amount: 300 }
  )

  // Try to submit output directly from PENDING without going ACTIVE first
  try {
    await orchestrator.transitionToReady(task3.id, 'LiveDjAgent', { val: 1 })
    assert.fail('Should have blocked transition directly from PENDING to READY_FOR_GOVERNOR')
  } catch (err: any) {
    assert.ok(err.message.includes('Invalid state transition'))
    console.log('✔ Blocked state skip from PENDING directly to READY')
  }


  // Test 4: Guard Failures & Retry logic
  console.log('\n--- Test 4: Guard Failures & Retry Capacity ---')
  const task4 = await orchestrator.createTask(
    'TaskFour',
    'ProfitBettingAgent',
    'LiveDjAgent',
    'BtaiGovernor',
    { amount: 400 },
    undefined,
    1 // Max retries = 1
  )

  await orchestrator.transitionToActive(task4.id, 'ProfitBettingAgent')

  // Attempt to transition to READY with empty outputs (EG-01 fails)
  try {
    await orchestrator.transitionToReady(task4.id, 'LiveDjAgent', {})
    assert.fail('Should have failed EG-01 output presence guard')
  } catch (err: any) {
    assert.ok(err.message.includes('Transition failed due to guard checks'))
    assert.strictEqual(task4.retryCount, 1)
    console.log('✔ Failed guard validation, retry count incremented to 1')
  }

  // Attempt to transition to READY again with empty outputs (exceeds max retries = 1)
  try {
    await orchestrator.transitionToReady(task4.id, 'LiveDjAgent', {})
    assert.fail('Should have transitioned task to FAILED after exceeding retries')
  } catch (err: any) {
    assert.ok(err.message.includes('transitioned to FAILED'))
    assert.strictEqual(task4.state, 'FAILED')
    console.log('✔ Task transitioned to FAILED after exceeding max retries')
  }


  // Test 5: Scoring Gate Guard
  console.log('\n--- Test 5: Scoring Gate Guard (GV-SCORE < 85) ---')
  const task5 = await orchestrator.createTask(
    'TaskFive',
    'ProfitBettingAgent',
    'LiveDjAgent',
    'BtaiGovernor',
    { amount: 500 }
  )

  await orchestrator.transitionToActive(task5.id, 'ProfitBettingAgent')
  await orchestrator.transitionToReady(task5.id, 'LiveDjAgent', { completed: true })

  // Try to approve task with score 80 (fails GV-08)
  try {
    await orchestrator.transitionToCompleted(task5.id, 'BtaiGovernor', 80)
    assert.fail('Should have failed scoring gate below 85')
  } catch (err: any) {
    assert.ok(err.message.includes('below the 85-point threshold'))
    assert.strictEqual(task5.state, 'FAILED')
    console.log('✔ Blocked completion and failed task due to low quality score (< 85)')
  }


  // Test 6: Temporal Guard (Deadline Exceeded)
  console.log('\n--- Test 6: Temporal Guard Deadline ---')
  const task6 = await orchestrator.createTask(
    'TaskSix',
    'ProfitBettingAgent',
    'LiveDjAgent',
    'BtaiGovernor',
    { amount: 600 },
    1, // 1ms deadline offset
    0  // maxRetries=0 so deadline failure goes straight to FAILED
  )

  // Sleep 10ms to let deadline expire
  await new Promise(resolve => setTimeout(resolve, 10))

  try {
    await orchestrator.transitionToActive(task6.id, 'ProfitBettingAgent')
    assert.fail('Should have failed deadline temporal guard')
  } catch (err: any) {
    assert.ok(err.message.includes('deadline'))
    assert.strictEqual(task6.state, 'FAILED')
    console.log('✔ Blocked task activation and failed task due to exceeded deadline')
  }


  // Test 7: Audit Trail Verification
  console.log('\n--- Test 7: Audit Trail Verification ---')
  const auditTrail = orchestrator.getAuditTrail()
  assert.ok(auditTrail.length > 0)
  
  // Verify structure of first entry
  const entry = auditTrail[0]
  assert.ok(entry.timestamp)
  assert.ok(entry.taskId)
  assert.strictEqual(entry.fromState, 'PENDING')
  assert.strictEqual(entry.toState, 'PENDING')
  assert.strictEqual(entry.actor.role, 'ORCHESTRATOR')
  assert.strictEqual(entry.success, true)
  
  console.log('✔ Audit trail file exists, parses correctly, and retains full state histories')
  console.log('=== All Handoff Orchestrator tests PASSED! ===')
}

runTests().catch(err => {
  console.error('Test suite failed:', err)
  process.exit(1)
})
