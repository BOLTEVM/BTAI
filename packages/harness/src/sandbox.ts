import { AgentBase } from './sdk'
import { IUnifiedState } from './telemetry'
import { BoltPromoterAgent } from './marketing/marketing-agent'

export class ProfitBettingAgent extends AgentBase {
  private activeTaskId: string | null = null

  async onTelemetryUpdate(state: IUnifiedState) {
    console.log(`[ProfitBettingAgent] Telemetry Tick: Fractal shares=${state.mining.fractal.shares_accepted}`)

    const fbHash = state.mining.fractal.hashrate
    if (fbHash < 100 && !state.mining.fractal.running) {
      console.log(`[ProfitBettingAgent] Hashing low on Fractal, powering on miner...`)
      await this.mining.toggleMiner('fractal', true)
    }

    // Trigger a handoff task if we have accumulated shares and no active task
    if (state.mining.fractal.shares_accepted > 5 && !this.activeTaskId) {
      console.log(`[ProfitBettingAgent] Mining shares achieved. Creating Handoff Task for LiveDjAgent...`)
      try {
        const task = await this.orchestrator.createTask(
          'BustaBoltBettingJob',
          'ProfitBettingAgent',
          'LiveDjAgent',
          'BtaiGovernor',
          { targetShares: 5, action: 'DJ_CRASH_EFFECT' }
        )
        this.activeTaskId = task.id
        console.log(`[ProfitBettingAgent] Created task ${task.id} in state ${task.state}`)

        // Start the task (move to ACTIVE)
        const activeTask = await this.orchestrator.startTask(task.id, 'ProfitBettingAgent')
        console.log(`[ProfitBettingAgent] Started task ${activeTask.id}. State is now ${activeTask.state}`)

        // Also place the bet on bustabolt
        await this.betting.placeBet('5000000000000000', 1.5)
      } catch (err: any) {
        console.error('[ProfitBettingAgent] Error in handoff creation:', err.message || err)
      }
    }
  }

  async onBettingEvent(event: any) {
    // If the game crashes, we notify or print. The LiveDjAgent will handle the actual handoff step
    if (event.type === 'GAME_CRASHED') {
      console.log(`[ProfitBettingAgent] Game crashed event received in Profit agent.`)
    }
  }
}

export class LiveDjAgent extends AgentBase {
  async onTelemetryUpdate(state: IUnifiedState) {
    // Idle state telemetry updates
  }

  async onBettingEvent(event: any) {
    console.log(`[LiveDjAgent] Betting event triggered: ${event.type}`)
    if (event.type === 'GAME_STARTING') {
      console.log(`[LiveDjAgent] Game Starting. Triggering Audio Synth Loop on DAW and webcam streaming overlays...`)
      await this.daw.triggerPerformanceClip(0, 1)
      await this.streaming.setSourceVisibility('StudioScene', 'BettingOverlay', true)
    }

    if (event.type === 'GAME_CRASHED') {
      console.log(`[LiveDjAgent] Game Crashed at ${event.multiplier}x. Muting channels and broadcasting crash flash...`)
      await this.daw.triggerPerformanceClip(1, 4)
      await this.streaming.triggerBannerText(`Crashed at ${event.multiplier}x!`)

      // Check if there are active tasks assigned to LiveDjAgent that need submission
      try {
        const tasks = await this.orchestrator.getTasks()
        const activeJob = tasks.find((t: any) => t.state === 'ACTIVE' && t.subagentId === 'LiveDjAgent')
        if (activeJob) {
          console.log(`[LiveDjAgent] Found active task ${activeJob.id}. Executing handoff completion...`)

          // Perform action, then submit task to READY_FOR_GOVERNOR
          const outputs = {
            status: 'SUCCESS',
            djActionTriggered: 'DJ_CRASH_EFFECT',
            multiplier: event.multiplier,
            timestamp: Date.now()
          }
          const submittedTask = await this.orchestrator.submitTask(activeJob.id, 'LiveDjAgent', outputs)
          console.log(`[LiveDjAgent] Submitted task ${submittedTask.id}. State: ${submittedTask.state}. Awaiting Governor approval.`)
        }
      } catch (err: any) {
        console.error('[LiveDjAgent] Error in handoff execution:', err.message || err)
      }
    }
  }
}

export class GameDesignerAgent extends AgentBase {
  async onTelemetryUpdate(state: IUnifiedState) {
    // Idle
  }

  public async designNewMechanic(name: string, subagentId: string, governorId: string, targetMechanic: string, specs: Record<string, any>) {
    console.log(`[GameDesignerAgent] Designing mechanic: ${targetMechanic}`)
    const task = await this.orchestrator.createTask(
      name,
      'GameDesignerAgent',
      subagentId,
      governorId,
      { targetMechanic, specs }
    )
    console.log(`[GameDesignerAgent] Created task ${task.id}. Starting execution...`)
    await this.orchestrator.startTask(task.id, 'GameDesignerAgent')
    return task.id
  }
}

export class GameplayCoderAgent extends AgentBase {
  async onTelemetryUpdate(state: IUnifiedState) {
    // Idle
  }

  public async writeAndSubmitCode(taskId: string, pythonCode: string) {
    console.log(`[GameplayCoderAgent] Submitting gameplay code for task ${taskId}...`)
    return this.orchestrator.submitTask(taskId, 'GameplayCoderAgent', { pythonCode })
  }
}

export class SimulationTesterAgent extends AgentBase {
  async onTelemetryUpdate(state: IUnifiedState) {
    // Idle
  }

  public async runSimulationAndEvaluate(taskId: string, mockTrajectoryHeight: number, expectedHeight: number) {
    console.log(`[SimulationTesterAgent] Running headless physics simulation for task ${taskId}...`)
    const task = await this.orchestrator.getTask(taskId)
    if (!task) throw new Error('Task not found')

    const simulationPassed = mockTrajectoryHeight >= expectedHeight
    console.log(`[SimulationTesterAgent] Trajectory verification: height=${mockTrajectoryHeight}, expected=${expectedHeight}, passed=${simulationPassed}`)

    task.outputs = { ...task.outputs, simulationPassed }
    const score = simulationPassed ? 92 : 70

    return this.orchestrator.approveTask(taskId, 'SimulationTesterAgent', score)
  }
}

export class AgentSandbox {
  private activeAgents: AgentBase[] = []

  constructor(private url: string = 'ws://localhost:3700') {}

  public async launchAgent(agentType: 'profit' | 'dj' | 'designer' | 'coder' | 'tester' | 'marketing') {
    let agent: AgentBase
    if (agentType === 'profit') {
      agent = new ProfitBettingAgent(this.url)
    } else if (agentType === 'dj') {
      agent = new LiveDjAgent(this.url)
    } else if (agentType === 'designer') {
      agent = new GameDesignerAgent(this.url)
    } else if (agentType === 'coder') {
      agent = new GameplayCoderAgent(this.url)
    } else if (agentType === 'marketing') {
      agent = BoltPromoterAgent.fromEnv(this.url)
    } else {
      agent = new SimulationTesterAgent(this.url)
    }
    await agent.start()
    this.activeAgents.push(agent)
    console.log(`[Sandbox] Launched agent instance for type: ${agentType}`)
  }

  public stopAll() {
    for (const agent of this.activeAgents) {
      try {
        agent.disconnect()
      } catch (_e) {
        /* best-effort cleanup */
      }
    }
    this.activeAgents = []
    console.log(`[Sandbox] Stopped all active agent instances and disconnected WebSockets.`)
  }
}
