import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'

export type TaskState = 'PENDING' | 'ACTIVE' | 'READY_FOR_GOVERNOR' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

export interface ITask {
  id: string
  name: string
  subagentId: string
  creatorId: string
  governorId: string
  state: TaskState
  inputs: Record<string, any>
  outputs: Record<string, any>
  score?: number
  createdAt: number
  updatedAt: number
  deadline?: number
  maxRetries: number
  retryCount: number
  retryableTransitions: TaskState[]
}

export interface IAuditTrailEntry {
  timestamp: number
  taskId: string
  fromState: TaskState
  toState: TaskState
  actor: { role: string; id: string }
  guardsEvaluated: Array<{
    code: string
    name: string
    passed: boolean
    reason?: string
  }>
  success: boolean
  error?: string
}

export class HandoffOrchestrator {
  private tasks = new Map<string, ITask>()
  private auditLogPath: string
  private taskLocks = new Map<string, Promise<void>>()
  private taskArchiveTTL: number
  private archivalInterval: ReturnType<typeof setInterval> | null = null

  constructor(baseDir: string = __dirname, archiveTTLMs = 5 * 60 * 1000) {
    this.auditLogPath = path.join(baseDir, '../audit_trail.json')
    this.taskArchiveTTL = archiveTTLMs
    this.initAuditLog()
    this.startArchivalTimer()
  }

  private initAuditLog() {
    const dir = path.dirname(this.auditLogPath)
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true })
      } catch (err) {
        console.error('[Orchestrator] Error creating audit log directory:', err)
      }
    }
  }

  private async withTaskLock<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    let releaseLock!: () => void
    const nextLock = new Promise<void>(resolve => { releaseLock = resolve })
    const prevLock = this.taskLocks.get(taskId) ?? Promise.resolve()
    this.taskLocks.set(taskId, nextLock)

    await prevLock
    try {
      return await fn()
    } finally {
      releaseLock()
    }
  }

  private startArchivalTimer() {
    this.archivalInterval = setInterval(() => {
      const count = this.archiveTerminalTasks()
      if (count > 0) {
        console.warn(`[Orchestrator] Archived ${count} terminal task(s) from memory`)
      }
    }, 60000)
    if (this.archivalInterval.unref) {
      this.archivalInterval.unref()
    }
  }

  public archiveTerminalTasks(): number {
    const now = Date.now()
    let archived = 0
    const terminalStates: TaskState[] = ['COMPLETED', 'FAILED', 'CANCELLED']
    for (const [id, task] of this.tasks.entries()) {
      if (terminalStates.includes(task.state) && (now - task.updatedAt) > this.taskArchiveTTL) {
        this.tasks.delete(id)
        archived++
      }
    }
    return archived
  }

  public destroy() {
    if (this.archivalInterval) {
      clearInterval(this.archivalInterval)
      this.archivalInterval = null
    }
  }

  public async createTask(
    name: string,
    creatorId: string,
    subagentId: string,
    governorId: string,
    inputs: Record<string, any>,
    deadlineOffsetMs?: number,
    maxRetries = 3,
    retryableTransitions: TaskState[] = ['READY_FOR_GOVERNOR', 'ACTIVE']
  ): Promise<ITask> {
    const id = `task-${randomUUID()}`
    const now = Date.now()
    const task: ITask = {
      id,
      name,
      creatorId,
      subagentId,
      governorId,
      state: 'PENDING',
      inputs,
      outputs: {},
      createdAt: now,
      updatedAt: now,
      deadline: deadlineOffsetMs ? now + deadlineOffsetMs : undefined,
      maxRetries,
      retryCount: 0,
      retryableTransitions
    }
    this.tasks.set(id, task)
    await this.logAudit(task.id, 'PENDING', 'PENDING', { role: 'ORCHESTRATOR', id: creatorId }, [], true)
    return task
  }

  private getTaskMutable(id: string): ITask | undefined {
    return this.tasks.get(id)
  }

  public getTask(id: string): ITask | undefined {
    const task = this.tasks.get(id)
    return task ? structuredClone(task) : undefined
  }

  public getTasks(): ITask[] {
    return Array.from(this.tasks.values()).map(t => structuredClone(t))
  }

  public async transitionToActive(taskId: string, actorId: string): Promise<ITask> {
    const task = this.getTaskMutable(taskId)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }

    const actor = { role: 'ORCHESTRATOR', id: actorId }
    this.validateRole(task, 'PENDING', 'ACTIVE', actor)

    const guards = [
      // OG-01: Input presence validation
      {
        code: 'OG-01',
        name: 'Input Presence Guard',
        evaluate: async () => {
          const hasInputs = Object.keys(task.inputs).length > 0
          return { passed: hasInputs, reason: hasInputs ? undefined : 'Task has no inputs' }
        }
      },
      // OG-02: Target executor validity
      {
        code: 'OG-02',
        name: 'Executor Compatibility Guard',
        evaluate: async () => {
          const validExecutor = typeof task.subagentId === 'string' && task.subagentId.length > 0
          return { passed: validExecutor, reason: validExecutor ? undefined : 'Invalid subagent executor specified' }
        }
      },
      // TG-01: Deadline validation
      {
        code: 'TG-01',
        name: 'Temporal Deadline Guard',
        evaluate: async () => {
          if (task.deadline && Date.now() > task.deadline) {
            return { passed: false, reason: 'Task deadline has already expired before starting' }
          }
          return { passed: true }
        }
      }
    ]

    await this.evaluateAndTransition(task, 'ACTIVE', actor, guards, 'PENDING')
    return task
  }

  public async transitionToReady(taskId: string, actorId: string, outputs: Record<string, any>): Promise<ITask> {
    const task = this.getTaskMutable(taskId)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }

    const actor = { role: 'EXECUTOR', id: actorId }
    this.validateRole(task, 'ACTIVE', 'READY_FOR_GOVERNOR', actor)

    const guards = [
      // EG-01: Output validation
      {
        code: 'EG-01',
        name: 'Output Validation Guard',
        evaluate: async () => {
          const hasOutputs = Object.keys(outputs).length > 0
          return { passed: hasOutputs, reason: hasOutputs ? undefined : 'Execution output is empty' }
        }
      },
      // EG-02: Output integrity check
      {
        code: 'EG-02',
        name: 'Output Integrity Guard',
        evaluate: async () => {
          const isObject = typeof outputs === 'object' && outputs !== null
          return { passed: isObject, reason: isObject ? undefined : 'Output is not a valid object' }
        }
      },
      // TG-01: Deadline validation
      {
        code: 'TG-01',
        name: 'Temporal Execution Guard',
        evaluate: async () => {
          if (task.deadline && Date.now() > task.deadline) {
            return { passed: false, reason: 'Task exceeded deadline' }
          }
          return { passed: true }
        }
      }
    ]

    if (outputs.pythonCode) {
      guards.push({
        code: 'EG-03',
        name: 'Python Syntax Guard',
        evaluate: async () => {
          const tempFile = path.join(os.tmpdir(), `guard_${randomUUID()}.py`)
          try {
            fs.writeFileSync(tempFile, outputs.pythonCode, 'utf8')
            return await new Promise<{ passed: boolean; reason?: string }>((resolve) => {
              execFile('python', ['-m', 'py_compile', tempFile], { timeout: 5000 }, (err) => {
                try { fs.unlinkSync(tempFile) } catch (_e) { /* best-effort cleanup */ }
                if (err) {
                  resolve({ passed: false, reason: `Python syntax check failed: ${err.message}` })
                } else {
                  resolve({ passed: true })
                }
              })
            })
          } catch (err: any) {
            try { fs.unlinkSync(tempFile) } catch (_e) { /* best-effort cleanup */ }
            return { passed: false, reason: `Failed to execute python compilation: ${err.message}` }
          }
        }
      })

      guards.push({
        code: 'EG-04',
        name: 'Sandbox Safety Guard',
        evaluate: async () => {
          const code = outputs.pythonCode
          const forbiddenPatterns = [
            { regex: /\bimport\s+(os|sys|subprocess|shutil|socket|requests|urllib)\b/, desc: 'forbidden import' },
            { regex: /\bfrom\s+(os|sys|subprocess|shutil|socket|requests|urllib)\b/, desc: 'forbidden import' },
            { regex: /\beval\s*\(/, desc: 'eval execution' },
            { regex: /\bexec\s*\(/, desc: 'exec execution' },
            { regex: /\b__import__\b/, desc: 'dynamic import' },
            { regex: /\bopen\s*\(/, desc: 'file access' }
          ]

          for (const pattern of forbiddenPatterns) {
            if (pattern.regex.test(code)) {
              return { passed: false, reason: `Sandbox safety breach: Detected ${pattern.desc}` }
            }
          }
          return { passed: true }
        }
      })
    }

    task.outputs = outputs
    await this.evaluateAndTransition(task, 'READY_FOR_GOVERNOR', actor, guards, 'ACTIVE')
    return task
  }

  public async transitionToCompleted(taskId: string, actorId: string, score: number): Promise<ITask> {
    const task = this.getTaskMutable(taskId)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }

    const actor = { role: 'GOVERNOR', id: actorId }
    this.validateRole(task, 'READY_FOR_GOVERNOR', 'COMPLETED', actor)

    const guards = [
      // GV-08 / GV-SCORE: Score gate
      {
        code: 'GV-08',
        name: 'Scoring Gate Guard',
        evaluate: async () => {
          const meetsThreshold = score >= 85
          return {
            passed: meetsThreshold,
            reason: meetsThreshold ? undefined : `Score ${score} is below the 85-point threshold`
          }
        }
      },
      // CG-01: Governor approval check
      {
        code: 'CG-01',
        name: 'Governor Approval Guard',
        evaluate: async () => {
          const validGovernor = actorId === task.governorId
          return { passed: validGovernor, reason: validGovernor ? undefined : 'Governor ID mismatch' }
        }
      }
    ]

    if (task.inputs.targetMechanic) {
      guards.push({
        code: 'GV-09',
        name: 'Game Simulation Guard',
        evaluate: async () => {
          const simulationPassed = task.outputs.simulationPassed === true
          return {
            passed: simulationPassed,
            reason: simulationPassed ? undefined : 'Headless simulation check failed: physics metrics do not match requirements'
          }
        }
      })
    }

    task.score = score
    await this.evaluateAndTransition(task, 'COMPLETED', actor, guards, 'READY_FOR_GOVERNOR')
    return task
  }

  public async transitionToFailed(taskId: string, actorId: string, reason: string): Promise<ITask> {
    const task = this.getTaskMutable(taskId)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }

    const terminalStates: TaskState[] = ['COMPLETED', 'FAILED', 'CANCELLED']
    if (terminalStates.includes(task.state)) {
      throw new Error(`Cannot fail task ${taskId}: already in terminal state ${task.state}`)
    }

    const actor = { role: 'SYSTEM', id: actorId }
    task.outputs = { ...task.outputs, failureReason: reason }
    await this.evaluateAndTransition(task, 'FAILED', actor, [])
    return task
  }

  public async cancelTask(taskId: string, actorId: string, actorRole: 'ORCHESTRATOR' | 'GOVERNOR'): Promise<ITask> {
    const task = this.getTaskMutable(taskId)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }

    const actor = { role: actorRole, id: actorId }
    if (task.state === 'COMPLETED' || task.state === 'FAILED' || task.state === 'CANCELLED') {
      throw new Error(`Cannot cancel task in final state: ${task.state}`)
    }

    await this.evaluateAndTransition(task, 'CANCELLED', actor, [])
    return task
  }

  private validateRole(task: ITask, expectedState: TaskState, nextState: TaskState, actor: { role: string; id: string }) {
    if (task.state !== expectedState) {
      throw new Error(`Invalid state transition: Cannot transition task ${task.id} from ${task.state} to ${nextState}`)
    }

    if (expectedState === 'PENDING' && actor.role !== 'ORCHESTRATOR') {
      throw new Error(`Role separation failure: Only ORCHESTRATOR can start tasks. Actor was ${actor.role}`)
    }

    if (expectedState === 'ACTIVE' && actor.role !== 'EXECUTOR') {
      throw new Error(`Role separation failure: Only EXECUTOR can submit tasks. Actor was ${actor.role}`)
    }

    if (expectedState === 'READY_FOR_GOVERNOR' && actor.role !== 'GOVERNOR') {
      throw new Error(`Role separation failure: Only GOVERNOR can approve/complete tasks. Actor was ${actor.role}`)
    }

    if (actor.role === 'EXECUTOR' && actor.id !== task.subagentId) {
      throw new Error(`Role separation failure: Task executor mismatch. Expected ${task.subagentId}, got ${actor.id}`)
    }

    if (actor.role === 'GOVERNOR' && actor.id !== task.governorId) {
      throw new Error(`Role separation failure: Task governor mismatch. Expected ${task.governorId}, got ${actor.id}`)
    }

    if (actor.role === 'ORCHESTRATOR' && actor.id !== task.creatorId) {
      throw new Error(`Role separation failure: Task creator mismatch. Expected ${task.creatorId}, got ${actor.id}`)
    }
  }

  private async evaluateAndTransition(
    task: ITask,
    nextState: TaskState,
    actor: { role: string; id: string },
    guards: Array<{ code: string; name: string; evaluate: () => Promise<{ passed: boolean; reason?: string }> }>,
    expectedFromState?: TaskState
  ) {
    return this.withTaskLock(task.id, async () => {
      if (expectedFromState && task.state !== expectedFromState) {
        throw new Error(`Concurrent state change detected: task ${task.id} expected state ${expectedFromState} but found ${task.state}`)
      }

      const fromState = task.state
      const evaluatedResults = []
      let allPassed = true

      for (const guard of guards) {
        try {
          const result = await guard.evaluate()
          evaluatedResults.push({
            code: guard.code,
            name: guard.name,
            passed: result.passed,
            reason: result.reason
          })
          if (!result.passed) {
            allPassed = false
          }
        } catch (err: any) {
          evaluatedResults.push({
            code: guard.code,
            name: guard.name,
            passed: false,
            reason: err.message || 'Error executing guard evaluation'
          })
          allPassed = false
        }
      }

      if (!allPassed) {
        if (task.retryableTransitions.includes(nextState) && task.retryCount < task.maxRetries) {
          task.retryCount++
          task.updatedAt = Date.now()
          await this.logAudit(task.id, fromState, fromState, actor, evaluatedResults, false, 'Guards failed, retry incremented')
          throw new Error(`Transition failed due to guard checks: ${evaluatedResults.filter(r => !r.passed).map(r => r.reason).join(', ')}. Retry ${task.retryCount}/${task.maxRetries}`)
        } else {
          // Write-ahead: log audit BEFORE state mutation
          await this.logAudit(task.id, fromState, 'FAILED', actor, evaluatedResults, false, 'Guards failed, transitioning to FAILED')
          task.state = 'FAILED'
          task.updatedAt = Date.now()
          throw new Error(`Transition failed due to guard checks and transitioned to FAILED: ${evaluatedResults.filter(r => !r.passed).map(r => r.reason).join(', ')}`)
        }
      }

      // Write-ahead: log audit BEFORE state mutation
      await this.logAudit(task.id, fromState, nextState, actor, evaluatedResults, true)
      task.state = nextState
      task.updatedAt = Date.now()
    })
  }

  private async logAudit(
    taskId: string,
    fromState: TaskState,
    toState: TaskState,
    actor: { role: string; id: string },
    guardsEvaluated: Array<{ code: string; name: string; passed: boolean; reason?: string }>,
    success: boolean,
    errorMsg?: string
  ): Promise<void> {
    const entry: IAuditTrailEntry = {
      timestamp: Date.now(),
      taskId,
      fromState,
      toState,
      actor,
      guardsEvaluated,
      success,
      error: errorMsg
    }

    try {
      await fs.promises.appendFile(this.auditLogPath, JSON.stringify(entry) + '\n', 'utf8')
    } catch (err) {
      console.error('[Orchestrator] Error logging audit trail:', err)
    }
  }

  public getAuditTrail(): IAuditTrailEntry[] {
    try {
      if (!fs.existsSync(this.auditLogPath)) {
        return []
      }
      const content = fs.readFileSync(this.auditLogPath, 'utf8')
      return content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => JSON.parse(line))
    } catch (err) {
      console.error('[Orchestrator] Error reading audit trail:', err)
      return []
    }
  }
}
