import { TelemetryAggregator } from './telemetry';
import { HandoffOrchestrator } from './orchestrator'

export interface IJsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: any;
}

export interface IJsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class JsonRpcHandler {
  constructor(
    private telemetry: TelemetryAggregator,
    private orchestrator: HandoffOrchestrator,
    private sendToSubsystem: (subsystem: string, payload: any) => Promise<any>
  ) {}

  public async handleRequest(req: IJsonRpcRequest, verifiedActorId?: string): Promise<IJsonRpcResponse> {
    const id = req.id !== undefined ? req.id : null;
    if (req.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid Request: jsonrpc version must be 2.0' }
      };
    }

    try {
      const result = await this.executeMethod(req.method, req.params, verifiedActorId);
      return { jsonrpc: '2.0', id, result };
    } catch (e: any) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: e.code || -32603,
          message: e.message || 'Internal Error'
        }
      };
    }
  }

  private async executeMethod(method: string, params: any, verifiedActorId?: string): Promise<any> {
    const parts = method.split('.');
    if (parts[0] !== 'harness') {
      throw { code: -32601, message: `Method not found: ${method}` };
    }

    const category = parts[1];
    const action = parts[2];

    switch (category) {
      case 'mining':
        return this.handleMining(action, params);
      case 'media':
        return this.handleMedia(action, params);
      case 'daw':
        return this.handleDaw(action, params);
      case 'bustabolt':
        return this.handleBustaBolt(action, params);
      case 'chainvas':
        return this.handleChainvas(action, params);
      case 'web3':
        return this.handleWeb3(action, params);
      case 'orchestrator':
        return this.handleOrchestrator(action, params, verifiedActorId)
      case 'marketing':
        return this.handleMarketing(action, params)
      default:
        throw { code: -32601, message: `Category not found: ${category}` };
    }
  }

  private async handleMining(action: string, params: any): Promise<any> {
    const state = this.telemetry.getState();
    switch (action) {
      case 'getStatus':
        return state.mining;
      case 'toggleMiner':
        const { substrate, active } = params;
        if (!['fractal', 'quai', 'qrl'].includes(substrate)) {
          throw { code: -32602, message: 'Invalid substrate name' };
        }
        await this.sendToSubsystem(substrate, { command: active ? 'START' : 'STOP' });
        this.telemetry.updateMining(substrate as any, { running: active });
        return { success: true, substrate, active };
      case 'setRemote':
        const { substrate: sub, useRemote } = params;
        await this.sendToSubsystem(sub, { command: 'TOGGLE_REMOTE', useRemote });
        return { success: true, substrate: sub, useRemote };
      case 'tuneHardware':
        return { success: true, message: 'Hardware tuned successfully', parameters: params };
      default:
        throw { code: -32601, message: `Action not found: ${action}` };
    }
  }

  private async handleMedia(action: string, params: any): Promise<any> {
    switch (action) {
      case 'getScenes':
        return this.telemetry.getState().media;
      case 'setActiveScene':
        const { sceneName } = params || {};
        this.validateSceneName(sceneName);
        await this.sendToSubsystem('bobs', { command: 'SET_SCENE', sceneName });
        this.telemetry.updateMedia({ currentScene: sceneName });
        return { success: true, activeScene: sceneName };
      case 'setSourceVisibility':
        const { sceneName: sName, sourceId, visible } = params || {};
        this.validateSceneName(sName);
        await this.sendToSubsystem('bobs', { command: 'TOGGLE_SOURCE', sceneName: sName, sourceId, visible });
        return { success: true, sourceId, visible };
      case 'startBroadcast':
        await this.sendToSubsystem('bobs', { command: 'START_BROADCAST', ...params });
        this.telemetry.updateMedia({ broadcasting: true });
        return { success: true, broadcasting: true };
      case 'stopBroadcast':
        await this.sendToSubsystem('bobs', { command: 'STOP_BROADCAST' });
        this.telemetry.updateMedia({ broadcasting: false });
        return { success: true, broadcasting: false };
      default:
        throw { code: -32601, message: `Action not found: ${action}` };
    }
  }

  private async handleDaw(action: string, params: any): Promise<any> {
    switch (action) {
      case 'getPlaybackStatus':
        return this.telemetry.getState().daw;
      case 'setPlaybackState':
        const { playing, bpm } = params || {};
        await this.sendToSubsystem('daw', { command: 'PLAYBACK_STATE', playing, bpm });
        this.telemetry.updateDaw({ playing, ...(bpm && { bpm }) });
        return { success: true, playing, bpm };
      case 'triggerPerformanceClip':
        const { trackIndex, clipIndex } = params || {};
        await this.sendToSubsystem('daw', { command: 'TRIGGER_CLIP', trackIndex, clipIndex });
        return { success: true, trackIndex, clipIndex };
      default:
        throw { code: -32601, message: `Action not found: ${action}` };
    }
  }

  private async handleBustaBolt(action: string, params: any): Promise<any> {
    switch (action) {
      case 'getGameState':
        return this.telemetry.getState().bustabolt;
      case 'placeBet':
        const { amountWei, autoCashout } = params || {};
        this.validateBet(amountWei, autoCashout);
        await this.sendToSubsystem('bustabolt', { command: 'PLACE_BET', amountWei, autoCashout });
        return { success: true, amountWei, autoCashout };
      case 'claimEarnings':
        const payload = await this.sendToSubsystem('bustabolt', { command: 'CLAIM_EARNINGS' });
        return { success: true, txHash: '0xabc...123', ...payload };
      default:
        throw { code: -32601, message: `Action not found: ${action}` };
    }
  }

  private async handleChainvas(action: string, params: any): Promise<any> {
    switch (action) {
      case 'getSessionState':
        return this.telemetry.getState().chainvas;
      case 'mintAsset':
        const { projectId, metadata } = params || {};
        const result = await this.sendToSubsystem('chainvas', { command: 'MINT_ASSET', projectId, metadata });
        this.telemetry.updateChainvas({ isMinting: true });
        return { success: true, projectId, ...result };
      case 'createLayer':
        const { layerName } = params || {};
        this.validateLayerName(layerName);
        await this.sendToSubsystem('chainvas', { command: 'CREATE_LAYER', layerName });
        return { success: true, layerName };
      default:
        throw { code: -32601, message: `Action not found: ${action}` };
    }
  }

  private async handleWeb3(action: string, params: any): Promise<any> {
    switch (action) {
      case 'verifyNFT':
        const { walletAddress } = params || {};
        const isMember = (walletAddress && walletAddress.startsWith('0x123')) || walletAddress === 'Admin';
        return { walletAddress, isMember };
      case 'triggerAgreement':
        const { agreementId, contractAction } = params || {};
        return { success: true, agreementId, status: contractAction === 'RELEASE' ? 'SETTLED' : 'ACTIVE' };
      default:
        throw { code: -32601, message: `Action not found: ${action}` };
    }
  }

  private validateSceneName(sceneName: any) {
    if (typeof sceneName !== 'string' || sceneName.length === 0 || sceneName.length > 50 || !/^[a-zA-Z0-9\s\-_]+$/.test(sceneName)) {
      throw { code: -32602, message: 'Invalid params: sceneName must be an alphanumeric string up to 50 characters (spaces, hyphens, and underscores allowed)' };
    }
  }

  private validateLayerName(layerName: any) {
    if (typeof layerName !== 'string' || layerName.length === 0 || layerName.length > 50 || !/^[a-zA-Z0-9\s\-_]+$/.test(layerName)) {
      throw { code: -32602, message: 'Invalid params: layerName must be an alphanumeric string up to 50 characters (spaces, hyphens, and underscores allowed)' };
    }
  }

  private validateBet(amountWei: any, autoCashout: any) {
    if (typeof amountWei !== 'string' || !/^\d+$/.test(amountWei) || amountWei.length === 0) {
      throw { code: -32602, message: 'Invalid params: amountWei must be a valid numeric string representing BigInt' };
    }
    const cashout = Number(autoCashout);
    if (typeof autoCashout !== 'number' || isNaN(cashout) || cashout < 1.01 || cashout > 100.0) {
      throw { code: -32602, message: 'Invalid params: autoCashout must be a positive number between 1.01 and 100.0' };
    }
  }

  private async handleOrchestrator(action: string, params: any, verifiedActorId?: string): Promise<any> {
    switch (action) {
      case 'createTask': {
        const { name, creatorId, subagentId, governorId, inputs, deadlineOffsetMs, maxRetries } = params || {}
        if (!name || typeof name !== 'string') throw { code: -32602, message: 'Missing or invalid param: name (string required)' }
        if (!creatorId || typeof creatorId !== 'string') throw { code: -32602, message: 'Missing or invalid param: creatorId (string required)' }
        if (!subagentId || typeof subagentId !== 'string') throw { code: -32602, message: 'Missing or invalid param: subagentId (string required)' }
        if (!governorId || typeof governorId !== 'string') throw { code: -32602, message: 'Missing or invalid param: governorId (string required)' }
        if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw { code: -32602, message: 'Missing or invalid param: inputs (object required)' }
        const effectiveCreatorId = this.resolveActorId(creatorId, verifiedActorId)
        return this.orchestrator.createTask(name, effectiveCreatorId, subagentId, governorId, inputs, deadlineOffsetMs, maxRetries)
      }
      case 'startTask': {
        const { taskId, actorId } = params || {}
        if (!taskId || typeof taskId !== 'string') throw { code: -32602, message: 'Missing or invalid param: taskId (string required)' }
        if (!actorId || typeof actorId !== 'string') throw { code: -32602, message: 'Missing or invalid param: actorId (string required)' }
        const effectiveActorId = this.resolveActorId(actorId, verifiedActorId)
        return this.orchestrator.transitionToActive(taskId, effectiveActorId)
      }
      case 'submitTask': {
        const { taskId, actorId, outputs } = params || {}
        if (!taskId || typeof taskId !== 'string') throw { code: -32602, message: 'Missing or invalid param: taskId (string required)' }
        if (!actorId || typeof actorId !== 'string') throw { code: -32602, message: 'Missing or invalid param: actorId (string required)' }
        if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) throw { code: -32602, message: 'Missing or invalid param: outputs (object required)' }
        const effectiveActorId = this.resolveActorId(actorId, verifiedActorId)
        return this.orchestrator.transitionToReady(taskId, effectiveActorId, outputs)
      }
      case 'approveTask': {
        const { taskId, actorId, score } = params || {}
        if (!taskId || typeof taskId !== 'string') throw { code: -32602, message: 'Missing or invalid param: taskId (string required)' }
        if (!actorId || typeof actorId !== 'string') throw { code: -32602, message: 'Missing or invalid param: actorId (string required)' }
        if (typeof score !== 'number' || !Number.isFinite(score)) throw { code: -32602, message: 'Missing or invalid param: score (finite number required)' }
        const effectiveActorId = this.resolveActorId(actorId, verifiedActorId)
        return this.orchestrator.transitionToCompleted(taskId, effectiveActorId, score)
      }
      case 'failTask': {
        const { taskId, actorId, reason } = params || {}
        if (!taskId || typeof taskId !== 'string') throw { code: -32602, message: 'Missing or invalid param: taskId (string required)' }
        if (!actorId || typeof actorId !== 'string') throw { code: -32602, message: 'Missing or invalid param: actorId (string required)' }
        if (!reason || typeof reason !== 'string') throw { code: -32602, message: 'Missing or invalid param: reason (string required)' }
        return this.orchestrator.transitionToFailed(taskId, actorId, reason)
      }
      case 'cancelTask': {
        const { taskId, actorId, actorRole } = params || {}
        if (!taskId || typeof taskId !== 'string') throw { code: -32602, message: 'Missing or invalid param: taskId (string required)' }
        if (!actorId || typeof actorId !== 'string') throw { code: -32602, message: 'Missing or invalid param: actorId (string required)' }
        if (actorRole !== 'ORCHESTRATOR' && actorRole !== 'GOVERNOR') throw { code: -32602, message: "Missing or invalid param: actorRole ('ORCHESTRATOR' | 'GOVERNOR' required)" }
        return this.orchestrator.cancelTask(taskId, actorId, actorRole)
      }
      case 'getTask': {
        const { taskId } = params || {}
        if (!taskId || typeof taskId !== 'string') throw { code: -32602, message: 'Missing or invalid param: taskId (string required)' }
        const task = this.orchestrator.getTask(taskId)
        if (!task) {
          throw { code: -32602, message: `Task ${taskId} not found` }
        }
        return task
      }
      case 'getTasks': {
        return this.orchestrator.getTasks()
      }
      case 'getAuditTrail': {
        return this.orchestrator.getAuditTrail()
      }
      default:
        throw { code: -32601, message: `Action not found: ${action}` }
    }
  }

  private resolveActorId(claimedId: string, verifiedId?: string): string {
    if (verifiedId && claimedId && verifiedId !== claimedId) {
      throw { code: -32602, message: `Identity mismatch: connection verified as '${verifiedId}' but claimed '${claimedId}'` }
    }
    return verifiedId || claimedId
  }

  private async handleMarketing(action: string, params: any): Promise<any> {
    switch (action) {
      case 'startCampaign': {
        const { campaignName } = params || {}
        if (!campaignName || typeof campaignName !== 'string') {
          throw { code: -32602, message: 'Missing or invalid param: campaignName (string required)' }
        }
        await this.sendToSubsystem('marketing', { command: 'START_CAMPAIGN', campaignName })
        return { success: true, campaignName, status: 'started' }
      }
      case 'stopCampaign': {
        const { campaignName } = params || {}
        if (!campaignName || typeof campaignName !== 'string') {
          throw { code: -32602, message: 'Missing or invalid param: campaignName (string required)' }
        }
        await this.sendToSubsystem('marketing', { command: 'STOP_CAMPAIGN', campaignName })
        return { success: true, campaignName, status: 'stopped' }
      }
      case 'triggerPost': {
        const { platform, topic } = params || {}
        if (!platform || typeof platform !== 'string') {
          throw { code: -32602, message: 'Missing or invalid param: platform (string required)' }
        }
        await this.sendToSubsystem('marketing', { command: 'TRIGGER_POST', platform, topic })
        return { success: true, platform, topic }
      }
      case 'getAnalytics': {
        const { timeRange } = params || {}
        const result = await this.sendToSubsystem('marketing', { command: 'GET_ANALYTICS', timeRange })
        return result
      }
      case 'getStatus': {
        const result = await this.sendToSubsystem('marketing', { command: 'GET_STATUS' })
        return result
      }
      case 'getActiveCampaigns': {
        const result = await this.sendToSubsystem('marketing', { command: 'GET_ACTIVE_CAMPAIGNS' })
        return result
      }
      default:
        throw { code: -32601, message: `Action not found: ${action}` }
    }
  }
}
