import express, { Express, Request, Response } from "express";
import { ChainAdapter } from "./chainAdapter";
import { FacilitatorConfig } from "./config";
import { Facilitator } from "./facilitator";
import { NonceRegistry } from "./nonceRegistry";
import { PaymentPayload, SCHEME, X402_VERSION } from "./types";

/**
 * x402 facilitator HTTP surface: /supported, /health, /verify, /settle.
 * Body is capped at 8kb — payment payloads are small by definition.
 */
export function createServer(
  config: FacilitatorConfig,
  adapter: ChainAdapter,
  registry: NonceRegistry
): Express {
  const facilitator = new Facilitator(config, adapter, registry);
  const app = express();
  app.use(express.json({ limit: "8kb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      facilitator: adapter.getAddress(),
      network: config.network,
      escrow: config.escrowAddress,
      registry: registry.stats(),
    });
  });

  app.get("/supported", (_req: Request, res: Response) => {
    res.json({
      kinds: [
        {
          x402Version: X402_VERSION,
          scheme: SCHEME,
          network: config.network,
          extra: {
            escrow: config.escrowAddress,
            settlementTokens: config.settlementTokens,
            eip712: { name: "BTAI Talent Agency", version: "1" },
          },
        },
      ],
      extensions: [],
      signers: { [config.network]: [adapter.getAddress()] },
    });
  });

  app.post("/verify", async (req: Request, res: Response) => {
    const result = await facilitator.verify(req.body as PaymentPayload);
    res.status(result.isValid ? 200 : 422).json(result);
  });

  app.post("/settle", async (req: Request, res: Response) => {
    const idempotencyKey = req.header("Idempotency-Key");
    if (!idempotencyKey || idempotencyKey.length > 128) {
      res.status(400).json({ success: false, errorReason: "idempotency_key_required", network: config.network });
      return;
    }
    const result = await facilitator.settle(req.body as PaymentPayload, idempotencyKey);
    res.status(result.success ? 200 : 422).json(result);
  });

  // Central error handler: never leak internals, always JSON.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: unknown) => {
    res.status(400).json({ success: false, errorReason: "malformed_request" });
  });

  return app;
}
