import WebSocket from 'ws';

export interface IMiningTelemetry {
  hashrate: number;
  shares_accepted: number;
  shares_rejected: number;
  uptime: number;
  difficulty: number;
  running: boolean;
  temp_c?: number;
}

export interface IMediaTelemetry {
  currentScene: string;
  scenes: string[];
  broadcasting: boolean;
  recording: boolean;
  fps: number;
  audioPeakL: number;
  audioPeakR: number;
}

export interface IDawTelemetry {
  playing: boolean;
  bpm: number;
  position: string;
  masterVolume: number;
}

export interface IBustaBoltTelemetry {
  multiplier: number;
  status: 'BETTING' | 'ACTIVE' | 'CRASHED';
  poolEth: string;
  poolSats: string;
}

export interface IB3jsTelemetry {
  fps: number;
  physicsLoad: number;
  entityCount: number;
}

export interface IChainvasTelemetry {
  documentType: 'PHOTO' | 'VIDEO' | 'INDESIGN';
  activeUsers: number;
  layerCount: number;
  isMinting: boolean;
}

export interface IMarketingTelemetry {
  activePlatforms: string[];
  postsToday: number;
  repliesToday: number;
  engagementRate: number;
  voiceMinutesToday: number;
  activeCampaigns: string[];
  lastPostTimestamps: Record<string, number>;
  topPlatform: string;
}

export interface IUnifiedState {
  mining: {
    fractal: IMiningTelemetry;
    quai: IMiningTelemetry;
    qrl: IMiningTelemetry;
  };
  media: IMediaTelemetry;
  daw: IDawTelemetry;
  bustabolt: IBustaBoltTelemetry;
  b3js: IB3jsTelemetry;
  chainvas: IChainvasTelemetry;
  marketing: IMarketingTelemetry;
  timestamp: number;
}

export class HarnessClient {
  private ws: WebSocket | null = null;
  private callId = 1;
  private pendingCalls = new Map<number, { resolve: (val: any) => void, reject: (err: any) => void }>();

  constructor(private url: string = 'ws://localhost:3700') {}

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => {
        resolve();
      });
      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.result !== undefined || msg.error !== undefined) {
            const pending = this.pendingCalls.get(msg.id);
            if (pending) {
              if (msg.error) pending.reject(msg.error);
              else pending.resolve(msg.result);
              this.pendingCalls.delete(msg.id);
            }
          }
        } catch (e) {
          // Ignore
        }
      });
      this.ws.on('error', (err) => {
        reject(err);
      });
    });
  }

  public call(method: string, params: any = {}, timeoutMs = 10000): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket not connected'));
    }
    const id = this.callId++;
    const payload = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCalls.delete(id);
        reject(new Error(`RPC call '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingCalls.set(id, {
        resolve: (val: any) => { clearTimeout(timeout); resolve(val); },
        reject: (err: any) => { clearTimeout(timeout); reject(err); }
      });
      this.ws!.send(JSON.stringify(payload));
    });
  }

  public getRawSocket(): WebSocket | null {
    return this.ws;
  }

  public disconnect() {
    if (this.ws) {
      // Reject all pending calls
      for (const [id, pending] of this.pendingCalls.entries()) {
        pending.reject(new Error('WebSocket disconnected'));
        this.pendingCalls.delete(id);
      }
      this.ws.close();
      this.ws = null;
    }
  }
}

export class MiningController {
  constructor(private client: HarnessClient) {}

  public async getStatus() {
    return this.client.call('harness.mining.getStatus');
  }

  public async switchAllResourcesTo(substrate: 'FRACTAL' | 'QUAI' | 'QRL') {
    const sub = substrate.toLowerCase();
    const otherSubstrates = ['fractal', 'quai', 'qrl'].filter(s => s !== sub);
    for (const other of otherSubstrates) {
      await this.client.call('harness.mining.toggleMiner', { substrate: other, active: false });
    }
    return this.client.call('harness.mining.toggleMiner', { substrate: sub, active: true });
  }

  public async toggleMiner(substrate: 'fractal' | 'quai' | 'qrl', active: boolean) {
    return this.client.call('harness.mining.toggleMiner', { substrate, active });
  }
}

export class StreamingController {
  constructor(private client: HarnessClient) {}

  public async setSourceVisibility(sceneName: string, sourceId: string, visible: boolean) {
    return this.client.call('harness.media.setSourceVisibility', { sceneName, sourceId, visible });
  }

  public async triggerBannerText(text: string) {
    return this.client.call('harness.media.setSourceVisibility', {
      sceneName: 'StudioScene',
      sourceId: 'BannerAlert',
      visible: true,
      text
    });
  }

  public async setActiveScene(sceneName: string) {
    return this.client.call('harness.media.setActiveScene', { sceneName });
  }
}

export class DawController {
  constructor(private client: HarnessClient) {}

  public async triggerPerformanceClip(trackIndex: number, clipIndex: number) {
    return this.client.call('harness.daw.triggerPerformanceClip', { trackIndex, clipIndex });
  }

  public async setPlaybackState(playing: boolean, bpm?: number) {
    return this.client.call('harness.daw.setPlaybackState', { playing, bpm });
  }
}

export class BettingController {
  constructor(private client: HarnessClient) {}

  public async placeBet(amountWei: string, autoCashout: number) {
    return this.client.call('harness.bustabolt.placeBet', { amountWei, autoCashout });
  }

  public async claimEarnings() {
    return this.client.call('harness.bustabolt.claimEarnings');
  }
}

export class ChainvasController {
  constructor(private client: HarnessClient) {}

  public async getSessionState() {
    return this.client.call('harness.chainvas.getSessionState');
  }

  public async mintAsset(projectId: string, metadata: any) {
    return this.client.call('harness.chainvas.mintAsset', { projectId, metadata });
  }

  public async createLayer(layerName: string) {
    return this.client.call('harness.chainvas.createLayer', { layerName });
  }
}

export class OrchestratorController {
  constructor(private client: HarnessClient) {}

  public async createTask(
    name: string,
    creatorId: string,
    subagentId: string,
    governorId: string,
    inputs: Record<string, any>,
    deadlineOffsetMs?: number,
    maxRetries?: number
  ) {
    return this.client.call('harness.orchestrator.createTask', {
      name,
      creatorId,
      subagentId,
      governorId,
      inputs,
      deadlineOffsetMs,
      maxRetries
    })
  }

  public async startTask(taskId: string, actorId: string) {
    return this.client.call('harness.orchestrator.startTask', { taskId, actorId })
  }

  public async submitTask(taskId: string, actorId: string, outputs: Record<string, any>) {
    return this.client.call('harness.orchestrator.submitTask', { taskId, actorId, outputs })
  }

  public async approveTask(taskId: string, actorId: string, score: number) {
    return this.client.call('harness.orchestrator.approveTask', { taskId, actorId, score })
  }

  public async getTask(taskId: string) {
    return this.client.call('harness.orchestrator.getTask', { taskId })
  }

  public async getTasks() {
    return this.client.call('harness.orchestrator.getTasks')
  }

  public async failTask(taskId: string, actorId: string, reason: string) {
    return this.client.call('harness.orchestrator.failTask', { taskId, actorId, reason })
  }

  public async cancelTask(taskId: string, actorId: string, actorRole: 'ORCHESTRATOR' | 'GOVERNOR') {
    return this.client.call('harness.orchestrator.cancelTask', { taskId, actorId, actorRole })
  }

  public async getAuditTrail() {
    return this.client.call('harness.orchestrator.getAuditTrail')
  }
}

export class MarketingController {
  constructor(private client: HarnessClient) {}

  public async startCampaign(campaignName: string) {
    return this.client.call('harness.marketing.startCampaign', { campaignName })
  }

  public async stopCampaign(campaignName: string) {
    return this.client.call('harness.marketing.stopCampaign', { campaignName })
  }

  public async triggerPost(platform: string, topic?: string) {
    return this.client.call('harness.marketing.triggerPost', { platform, topic })
  }

  public async getAnalytics(timeRange?: string) {
    return this.client.call('harness.marketing.getAnalytics', { timeRange })
  }

  public async getStatus() {
    return this.client.call('harness.marketing.getStatus')
  }

  public async getActiveCampaigns() {
    return this.client.call('harness.marketing.getActiveCampaigns')
  }
}

export abstract class AgentBase {
  protected client: HarnessClient
  protected mining: MiningController
  protected streaming: StreamingController
  protected daw: DawController
  protected betting: BettingController
  protected chainvas: ChainvasController
  protected orchestrator: OrchestratorController
  protected marketing: MarketingController

  constructor(url: string = 'ws://localhost:3700') {
    this.client = new HarnessClient(url)
    this.mining = new MiningController(this.client)
    this.streaming = new StreamingController(this.client)
    this.daw = new DawController(this.client)
    this.betting = new BettingController(this.client)
    this.chainvas = new ChainvasController(this.client)
    this.orchestrator = new OrchestratorController(this.client)
    this.marketing = new MarketingController(this.client)
  }

  public async start(): Promise<void> {
    await this.client.connect()
    const ws = this.client.getRawSocket()
    if (ws) {
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString())
          if (msg.type === 'TELEMETRY_UPDATE') {
            Promise.resolve(this.onTelemetryUpdate(msg.state)).catch(err => {
              console.error(`[AgentBase] Error in onTelemetryUpdate for ${this.constructor.name}:`, err)
            })
          } else if (msg.type === 'BETTING_EVENT') {
            Promise.resolve(this.onBettingEvent(msg.event)).catch(err => {
              console.error(`[AgentBase] Error in onBettingEvent for ${this.constructor.name}:`, err)
            })
          } else if (msg.type === 'MINING_EVENT') {
            Promise.resolve(this.onMiningEvent(msg.event)).catch(err => {
              console.error(`[AgentBase] Error in onMiningEvent for ${this.constructor.name}:`, err)
            })
          } else if (msg.type === 'ORCHESTRATOR_EVENT') {
            Promise.resolve(this.onOrchestratorEvent(msg.event)).catch(err => {
              console.error(`[AgentBase] Error in onOrchestratorEvent for ${this.constructor.name}:`, err)
            })
          }
        } catch (e) {
          // Ignore
        }
      })
    }
    console.log(`Agent ${this.constructor.name} successfully launched and listening.`)
  }

  abstract onTelemetryUpdate(state: IUnifiedState): Promise<void> | void;
  onBettingEvent(_event: any): Promise<void> | void {}
  onMiningEvent(_event: any): Promise<void> | void {}
  onOrchestratorEvent(_event: any): Promise<void> | void {}

  public disconnect() {
    this.client.disconnect();
  }
}
