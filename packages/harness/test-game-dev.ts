import { HandoffOrchestrator } from './src/orchestrator'
import * as assert from 'assert'
import * as fs from 'fs'
import * as path from 'path'

async function runGameDevTests() {
  console.log('=== Starting Game Dev Orchestration Pipeline Test Suite ===')
  const orchestrator = new HandoffOrchestrator(__dirname)

  // Clear previous audit trails to start clean
  const auditPath = path.join(__dirname, 'audit_trail.json')
  if (fs.existsSync(auditPath)) {
    fs.writeFileSync(auditPath, '', 'utf8')
  }

  // Test 1: Happy Path (Double Jump Mechanic)
  console.log('\n--- Test 1: Happy Path (Double Jump Mechanic) ---')
  const task1 = await orchestrator.createTask(
    'DoubleJumpMechanic',
    'GameDesignerAgent',
    'GameplayCoderAgent',
    'SimulationTesterAgent',
    { targetMechanic: 'DoubleJump', targetHeight: 12.0 }
  )
  assert.strictEqual(task1.state, 'PENDING')

  await orchestrator.transitionToActive(task1.id, 'GameDesignerAgent')
  assert.strictEqual(task1.state, 'ACTIVE')
  console.log('✔ Task activated (OG passed)')

  const validPythonCode = `
class DoubleJump:
    def __init__(self, obj):
        self.obj = obj
        self.jumps = 0
    def jump(self):
        if self.jumps < 2:
            self.jumps += 1
            return 12.5
        return 0
`
  // Submit code (EG-03 and EG-04 will run and pass)
  await orchestrator.transitionToReady(task1.id, 'GameplayCoderAgent', {
    pythonCode: validPythonCode,
    simulationPassed: true
  })
  assert.strictEqual(task1.state, 'READY_FOR_GOVERNOR')
  console.log('✔ Valid Python code submitted (EG-03 Syntax & EG-04 Sandbox passed)')

  // Governor approves with trajectory evaluation passing
  await orchestrator.transitionToCompleted(task1.id, 'SimulationTesterAgent', 92)
  assert.strictEqual(task1.state, 'COMPLETED')
  console.log('✔ Trajectory simulation approved by Governor (GV-SCORE & GV-09 passed)')


  // Test 2: Syntax Guard Failure (EG-03)
  console.log('\n--- Test 2: Python Syntax Guard Failure (EG-03) ---')
  const task2 = await orchestrator.createTask(
    'MangledMechanic',
    'GameDesignerAgent',
    'GameplayCoderAgent',
    'SimulationTesterAgent',
    { targetMechanic: 'WallRun' }
  )

  await orchestrator.transitionToActive(task2.id, 'GameDesignerAgent')

  const brokenPythonCode = `
class WallRun
    def run(self
        print("mangled syntax missing colon and paren")
`

  try {
    await orchestrator.transitionToReady(task2.id, 'GameplayCoderAgent', {
      pythonCode: brokenPythonCode
    })
    assert.fail('Should have failed syntax compilation guard')
  } catch (err: any) {
    assert.ok(err.message.includes('Python syntax check failed') || err.message.includes('transitioned to FAILED'))
    console.log('✔ Blocked broken Python code correctly via Syntax Guard (EG-03)')
  }


  // Test 3: Sandbox Safety Guard Failure (EG-04)
  console.log('\n--- Test 3: Sandbox Safety Guard Failure (EG-04) ---')
  const task3 = await orchestrator.createTask(
    'ExploitMechanic',
    'GameDesignerAgent',
    'GameplayCoderAgent',
    'SimulationTesterAgent',
    { targetMechanic: 'SpeedHack' }
  )

  await orchestrator.transitionToActive(task3.id, 'GameDesignerAgent')

  const exploitCode = `
import os
class SpeedHack:
    def hack(self):
        os.system("echo exploit")
`

  try {
    await orchestrator.transitionToReady(task3.id, 'GameplayCoderAgent', {
      pythonCode: exploitCode
    })
    assert.fail('Should have failed sandbox safety guard')
  } catch (err: any) {
    assert.ok(err.message.includes('Sandbox safety breach'))
    console.log('✔ Blocked exploit Python code correctly via Safety Guard (EG-04)')
  }


  // Test 4: Game Simulation Trajectory Failure (GV-09)
  console.log('\n--- Test 4: Game Simulation Guard Failure (GV-09) ---')
  const task4 = await orchestrator.createTask(
    'UnderpowerMechanic',
    'GameDesignerAgent',
    'GameplayCoderAgent',
    'SimulationTesterAgent',
    { targetMechanic: 'SuperJump', targetHeight: 50.0 }
  )

  await orchestrator.transitionToActive(task4.id, 'GameDesignerAgent')

  const underpowerCode = `
class SuperJump:
    def jump(self):
        return 1.5 # Insufficient force
`

  // Submit but physics simulation telemetry fails
  await orchestrator.transitionToReady(task4.id, 'GameplayCoderAgent', {
    pythonCode: underpowerCode,
    simulationPassed: false // Simulation reports height checks failed
  })

  // Governor tries to approve, but GV-09 simulation check blocks it
  try {
    await orchestrator.transitionToCompleted(task4.id, 'SimulationTesterAgent', 90)
    assert.fail('Should have blocked task approval due to simulation failure')
  } catch (err: any) {
    assert.ok(err.message.includes('Headless simulation check failed') || err.message.includes('transitioned to FAILED'))
    console.log('✔ Blocked task approval correctly via Game Simulation Guard (GV-09)')
  }

  console.log('\n=== All Game Dev Orchestration Pipeline tests PASSED! ===')
}

runGameDevTests().catch(err => {
  console.error('Game Dev test suite failed:', err)
  process.exit(1)
})
