/** Minimal EIP-1193 surface — every browser extension and modal wallet exposes this. */
export interface Eip1193Provider {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

declare global {
    interface Window {
        ethereum?: Eip1193Provider;
    }
}

export interface BaiAgentTxRequest {
    to: string;
    from?: string;
    data?: string;
    value?: bigint | string;
    gasLimit?: bigint | string;
    chainId?: number;
    rpcUrl?: string;
    provider?: Eip1193Provider;
    confirmations?: number;
    timeoutMs?: number;
    agentId?: string;
    modelId?: string;
    promptHash?: string;
    inferenceCost?: string;
    onProgress?: (progress: BaiPipelineProgress) => void;
}

/** Contract deployment: bytecode with no recipient. */
export interface BaiAgentDeployRequest extends Omit<BaiAgentTxRequest, 'to' | 'data'> {
    bytecode: string;
    /** ABI-encoded constructor arguments, appended to the bytecode. */
    constructorArgs?: string;
    /** Human label used in progress messages. */
    contractName?: string;
}

export interface BaiTxReceipt {
    transactionHash: string;
    blockNumber: number;
    contractAddress?: string;
    status: 'success' | 'reverted';
}

export interface BaiAgentTxResult {
    success: boolean;
    txHash?: string;
    /** Address of the newly deployed contract, for deployment transactions. */
    contractAddress?: string;
    receipt?: BaiTxReceipt;
    violations?: unknown[];
    error?: string;
}

export type BaiPipelineStage =
    | 'resolving-account'
    | 'switching-chain'
    | 'awaiting-signature'
    | 'awaiting-confirmation'
    | 'confirmed'
    | 'failed';

export interface BaiPipelineProgress {
    stage: BaiPipelineStage;
    /** Message suitable for rendering directly in the UI. */
    message: string;
    txHash?: string;
    /** Confirmations observed so far, once the transaction is mined. */
    confirmations?: number;
    contractAddress?: string;
}

interface PollOptions {
    provider?: Eip1193Provider;
    confirmations?: number;
    pollIntervalMs?: number;
    onProgress?: (progress: BaiPipelineProgress) => void;
}

/** Receipt as returned over JSON-RPC, before normalisation. */
interface RawTxReceipt {
    transactionHash?: string;
    blockNumber?: string;
    status?: string | number;
    contractAddress?: string | null;
}

interface TransactionParams {
    from: string;
    data: string;
    value: string;
    to?: string;
    gas?: string;
}

/** Shape of the optional 'theguards' pipeline, when it is installed. */
interface GuardsModule {
    TheGuardsWalletPipeline?: {
        executeAndAwaitTransaction?: (req: BaiAgentTxRequest) => Promise<BaiAgentTxResult>;
        deployAndAwaitContract?: (req: BaiAgentDeployRequest) => Promise<BaiAgentTxResult>;
    };
}

interface ProviderError {
    code?: number;
    message?: string;
    data?: { message?: string };
}

function asProviderError(err: unknown): ProviderError {
    return typeof err === 'object' && err !== null ? (err as ProviderError) : {};
}

/**
 * Bolt AI (BAI) Stack Wallet Pipeline
 * Native Web3 transaction execution pipeline for bai AI agent stack folder.
 * Handles AI Agent autonomous micropayments, inference staking, and smart contract calls.
 * Operates 100% standalone if 'theguards' package is not installed.
 *
 * Every entry point resolves only once the transaction is mined and confirmed, so
 * callers await a real on-chain outcome rather than a broadcast acknowledgement.
 * Confirmations are read back through the caller's own EIP-1193 provider when one
 * is supplied — that is what lets browser-extension and modal wallets be awaited
 * on public networks, where no local RPC endpoint is reachable.
 */
export class BaiWalletPipeline {
    /**
     * Executes an AI Agent Web3 transaction and AWAITS on-chain block receipt verification.
     */
    public static async executeAndAwaitTransaction(
        req: BaiAgentTxRequest
    ): Promise<BaiAgentTxResult> {
        console.log(`[BaiWalletPipeline] Executing AI Agent transaction for Agent [${req.agentId || 'DEFAULT_AGENT'}] (Model: ${req.modelId || 'DEFAULT_MODEL'}) to ${req.to}...`);

        const delegate = this.loadGuards()?.TheGuardsWalletPipeline?.executeAndAwaitTransaction;
        if (delegate) return delegate(req);

        if (!req.to || !req.to.startsWith('0x') || req.to.length !== 42) {
            return { success: false, error: `Invalid recipient address: "${req.to}"` };
        }

        return this.submitAndAwait(req, { to: req.to, data: req.data || '0x' });
    }

    /**
     * Deploys a contract and AWAITS the receipt, resolving with the live address.
     */
    public static async deployAndAwaitContract(
        req: BaiAgentDeployRequest
    ): Promise<BaiAgentTxResult> {
        const label = req.contractName || 'contract';
        console.log(`[BaiWalletPipeline] Deploying ${label} for Agent [${req.agentId || 'DEFAULT_AGENT'}]...`);

        const delegate = this.loadGuards()?.TheGuardsWalletPipeline?.deployAndAwaitContract;
        if (delegate) return delegate(req);

        if (!req.bytecode || !req.bytecode.startsWith('0x') || req.bytecode.length < 4) {
            return { success: false, error: 'Deployment bytecode is missing or malformed.' };
        }

        const args = (req.constructorArgs || '').replace(/^0x/, '');
        const result = await this.submitAndAwait(req, { data: req.bytecode + args });

        // A successful deployment always carries an address; treat its absence as
        // a failure rather than handing the caller an undefined contract.
        if (result.success && !result.contractAddress) {
            return {
                ...result,
                success: false,
                error: 'Transaction succeeded but the receipt carried no contract address.',
            };
        }
        return result;
    }

    /** Shared submit-then-await path for both calls and deployments. */
    private static async submitAndAwait(
        req: BaiAgentTxRequest | BaiAgentDeployRequest,
        payload: { to?: string; data: string }
    ): Promise<BaiAgentTxResult> {
        const timeoutMs = req.timeoutMs || 180_000;
        const onProgress = req.onProgress;
        const provider = req.provider || (typeof window !== 'undefined' ? window.ethereum : undefined);

        if (!provider || typeof provider.request !== 'function') {
            const error = 'No EIP-1193 wallet provider available. Connect a browser extension or modal wallet first.';
            onProgress?.({ stage: 'failed', message: error });
            return { success: false, error };
        }

        try {
            onProgress?.({ stage: 'resolving-account', message: 'Resolving the signing account...' });
            let fromAddress = req.from;
            if (!fromAddress) {
                const accounts = (await provider.request({ method: 'eth_accounts' })) as string[] | undefined;
                fromAddress = accounts && accounts.length > 0 ? accounts[0] : undefined;
            }
            if (!fromAddress) {
                const error = 'Wallet is connected but exposed no accounts.';
                onProgress?.({ stage: 'failed', message: error });
                return { success: false, error };
            }

            if (req.chainId) {
                onProgress?.({ stage: 'switching-chain', message: `Switching the wallet to chain ${req.chainId}...` });
                const switched = await this.ensureChain(provider, req.chainId, req.rpcUrl);
                if (!switched.success) {
                    onProgress?.({ stage: 'failed', message: switched.error as string });
                    return { success: false, error: switched.error };
                }
            }

            const txParams: TransactionParams = {
                from: fromAddress,
                data: payload.data,
                value: req.value ? '0x' + BigInt(req.value).toString(16) : '0x0',
            };
            // Deployments must omit `to` entirely; some wallets reject an explicit null.
            if (payload.to) txParams.to = payload.to;
            if (req.gasLimit) txParams.gas = '0x' + BigInt(req.gasLimit).toString(16);

            onProgress?.({ stage: 'awaiting-signature', message: 'Waiting for approval in your wallet...' });
            const txHash = (await provider.request({
                method: 'eth_sendTransaction',
                params: [txParams],
            })) as string;

            return this.waitForReceipt(txHash, req.rpcUrl, timeoutMs, {
                provider,
                confirmations: req.confirmations,
                onProgress,
            });
        } catch (err: unknown) {
            const error = this.describeProviderError(err, 'Transaction submission failed.');
            onProgress?.({ stage: 'failed', message: error });
            return { success: false, error };
        }
    }

    public static async ensureChain(
        provider: Eip1193Provider,
        chainId: number,
        rpcUrl?: string
    ): Promise<{ success: boolean; error?: string }> {
        const hexChainId = '0x' + chainId.toString(16);

        // Skip the prompt entirely when the wallet is already on the right chain.
        try {
            const current = await provider.request({ method: 'eth_chainId' });
            if (typeof current === 'string' && current.toLowerCase() === hexChainId) {
                return { success: true };
            }
        } catch {
            // Fall through and ask the wallet to switch.
        }

        try {
            await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] });
            return { success: true };
        } catch (switchError: unknown) {
            const parsed = asProviderError(switchError);
            if (parsed.code === 4902 || parsed.message?.includes('Unrecognized chain')) {
                if (!rpcUrl) {
                    return {
                        success: false,
                        error: `Chain ${chainId} is not configured in this wallet, and no rpcUrl was supplied to add it.`,
                    };
                }
                try {
                    await provider.request({
                        method: 'wallet_addEthereumChain',
                        params: [{ chainId: hexChainId, chainName: `Chain ${chainId}`, rpcUrls: [rpcUrl] }],
                    });
                    return { success: true };
                } catch (addError: unknown) {
                    return { success: false, error: this.describeProviderError(addError, 'Could not add the network to this wallet.') };
                }
            }
            return { success: false, error: this.describeProviderError(switchError, 'Could not switch the wallet network.') };
        }
    }

    /**
     * Polls until the transaction is mined and confirmed, or the timeout elapses.
     *
     * Reads through `options.provider` when one is given and falls back to a raw
     * JSON-RPC endpoint otherwise. A wallet extension is the only node most users
     * can reach, so the provider path is the one that matters in the browser.
     */
    public static async waitForReceipt(
        txHash: string,
        rpcUrl?: string,
        timeoutMs: number = 180_000,
        options: PollOptions = {}
    ): Promise<BaiAgentTxResult> {
        const { provider, onProgress } = options;
        const confirmations = Math.max(1, options.confirmations ?? 1);
        const pollIntervalMs = options.pollIntervalMs ?? 1500;

        if (!provider && !rpcUrl) {
            const error = 'No provider or rpcUrl available to read the receipt from.';
            onProgress?.({ stage: 'failed', message: error, txHash });
            return { success: false, txHash, error };
        }

        const rpc = async (method: string, params: unknown[]): Promise<unknown> => {
            if (provider) return provider.request({ method, params });
            const res = await fetch(rpcUrl as string, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
            });
            if (!res.ok) throw new Error(`RPC ${method} returned ${res.status}`);
            const json = await res.json();
            if (json.error) throw new Error(json.error.message || `RPC ${method} failed`);
            return json.result;
        };

        onProgress?.({ stage: 'awaiting-confirmation', message: 'Waiting for the transaction to be mined...', txHash });

        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            try {
                const receipt = (await rpc('eth_getTransactionReceipt', [txHash])) as RawTxReceipt | null;
                if (receipt && receipt.blockNumber) {
                    const isSuccess = receipt.status === '0x1' || receipt.status === 1 || receipt.status === '1';
                    const minedAt = parseInt(receipt.blockNumber, 16);

                    if (isSuccess && confirmations > 1) {
                        const head = parseInt((await rpc('eth_blockNumber', [])) as string, 16);
                        const seen = Math.max(head - minedAt + 1, 0);
                        if (seen < confirmations) {
                            onProgress?.({
                                stage: 'awaiting-confirmation',
                                message: `Mined. Waiting for confirmations (${seen}/${confirmations})...`,
                                txHash,
                                confirmations: seen,
                            });
                            await new Promise((r) => setTimeout(r, pollIntervalMs));
                            continue;
                        }
                    }

                    const contractAddress = receipt.contractAddress || undefined;
                    onProgress?.({
                        stage: isSuccess ? 'confirmed' : 'failed',
                        message: isSuccess
                            ? contractAddress
                                ? `Confirmed. Contract is live at ${contractAddress}.`
                                : 'Confirmed on-chain.'
                            : 'Transaction reverted on-chain.',
                        txHash,
                        confirmations,
                        contractAddress,
                    });

                    return {
                        success: isSuccess,
                        txHash,
                        contractAddress,
                        receipt: {
                            transactionHash: receipt.transactionHash || txHash,
                            blockNumber: minedAt,
                            contractAddress,
                            status: isSuccess ? 'success' : 'reverted',
                        },
                        error: isSuccess ? undefined : 'AI agent transaction reverted on-chain.',
                    };
                }
            } catch {
                // Transient RPC failure — keep polling until the timeout.
            }
            await new Promise((r) => setTimeout(r, pollIntervalMs));
        }

        const error = `Receipt confirmation timed out after ${Math.round(timeoutMs / 1000)}s.`;
        onProgress?.({ stage: 'failed', message: error, txHash });
        return { success: false, txHash, error };
    }

    /**
     * Resolves the optional 'theguards' pipeline once, if it is installed.
     *
     * Absent in standalone deployments and never present in a browser bundle,
     * where `require` does not exist — both cases fall through to null and the
     * native implementation runs. Memoized so the lookup, and the bundler's
     * unresolved-optional-dependency warning, happens in exactly one place.
     */
    private static guards: GuardsModule | null | undefined = undefined;

    private static loadGuards(): GuardsModule | null {
        if (this.guards !== undefined) return this.guards;
        this.guards = null;
        try {
            // Deliberate runtime lookup of an optional peer that may not exist.
            // The specifier is computed so bundlers cannot statically resolve it:
            // at suite depth it now DOES resolve (darkcircle/bai sits one level
            // deeper than the old repo root), and theguards pulls in Node
            // builtins (`fs`) that break the browser bundle. Runtime `require`
            // in a plain browser does not exist either way — both cases fall
            // through to null and the native implementation runs.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const specifier = ["..", "..", "..", "..", "..", "..", "theguards"].join("/");
            this.guards = (require(specifier) as GuardsModule) ?? null;
        } catch {
            // Standalone mode fallback
        }
        return this.guards;
    }

    /** Turns EIP-1193 error codes into something worth showing a user. */
    private static describeProviderError(err: unknown, fallback: string): string {
        const parsed = asProviderError(err);
        if (parsed.code === 4001) return 'Request rejected in the wallet.';
        if (parsed.code === -32002) return 'Your wallet already has a pending request. Open it and resolve that one first.';
        if (parsed.code === -32603) return `Wallet internal error: ${parsed.data?.message || parsed.message || fallback}`;
        return parsed.message || fallback;
    }
}
