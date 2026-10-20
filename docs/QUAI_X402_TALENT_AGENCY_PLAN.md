# BTAI → QUAI Network: X402 Talent Agency Migration Plan

**Status:** Deployed & live-verified — 2026-10-19 (Phases 0–3 complete; Phase 2 Orchard and Phase 5 mainnet deployments done, live gasless x402 settlement proven end-to-end on Orchard; owner elected to deploy without the Phase-4 external audit)
**Scope:** `bai/` monorepo (`apps/frontend`, `apps/backend`, `packages/contracts`, `packages/agent-sdk`, `packages/harness`)
**Goal:** Operate the BTAI Talent Protocol on QUAI Network as an x402-native talent agency, with smart-contract and operational security as first-class constraints.

---

## 1. Current-State Analysis (what exists today)

### 1.1 Architecture inventory

| Layer | Location | Stack | Role |
|---|---|---|---|
| Frontend | `apps/frontend` | Next.js 16 (Turbopack), Tailwind, Privy, viem | Talent registry UI, escrow deploy flow, x402-styled payment rail |
| Backend | `apps/backend` | Python FastAPI + SQLite | Talent profile CRUD, `/chat` (disabled, 503) |
| Contracts | `packages/contracts` | Vyper 0.3.10 `TalentAgent.vy` + Hardhat | Escrow: agreements, deposit, release, cancel/refund |
| Agent SDK | `packages/agent-sdk` | TypeScript WebSocket client | Harness controllers — **already includes QUAI mining telemetry** (`IUnifiedState.mining.quai`) |
| Harness | `packages/harness` | TypeScript orchestrator | Task lifecycle, audit trail, marketing adapters |

### 1.2 The escrow contract is in good shape

`TalentAgent.vy` already implements the patterns we want to keep:

- **CEI ordering everywhere** — effects written before every `transferFrom`/`transfer`.
- **`@nonreentrant("lock")`** on all token-moving entry points.
- **Truthy-return assertions** on ERC-20 calls (defeats non-reverting token spoofing).
- **Atomic client-initiated funding** (`create_and_deposit`) which closes the "unfunded agreement claimed by a stranger" gap.
- **Fork-tested against real canonical USDC** on Base (`packages/contracts/test/TalentAgent.test.js`), not a mock token.

### 1.3 Gaps relative to a production talent agency

1. **The payment rail is "x402-styled", not x402.** It is a bespoke `approve` + `create_and_deposit` two-transaction flow. There is no HTTP 402 challenge, no `PAYMENT-REQUIRED` header, no facilitator, no EIP-3009. To be an "X402 Talent Agency" we must adopt the real protocol.
2. **No milestones.** A single lump-sum agreement; real engagements need milestone-scoped releases.
3. **No protocol fee.** The agency takes no revenue cut on-chain.
4. **No dispute path.** Only `agent` can cancel; there is no arbiter/timeout mechanism if the client goes silent.
5. **Single-EOA agent key.** `set_agent` is one-step; no two-step transfer, no multisig, no timelock.
6. **No token allowlist.** Any token address can be passed to `create_agreement`/`create_and_deposit`; the return-value assert mitigates spoofing, but a malicious token still controls callbacks and accounting semantics. On QUAI this matters more (see §2.3).
7. **No pausability / emergency stop.**

### 1.4 Security findings in the repo (fix regardless of QUAI)

- ~~**CRITICAL — hardcoded API key in source**~~ — **resolved 2026-10-19 by removing the third-party report-integration module entirely** (owner discontinued the service); the key committed in git history must still be considered leaked and rotated provider-side.
- **MEDIUM — SQLite + no auth on talent writes:** `POST/PUT /talent` are unauthenticated. Before this becomes the registry backing real escrow recipients, add wallet-signature auth (SIWE-style) so a talent's `receive_address` cannot be rewritten by anyone who can reach the API.
- **LOW — CORS is opt-in:** if `BTAI_ALLOWED_ORIGINS` is unset, no CORS middleware is added — good — but document that production MUST set it explicitly.
- **LOW — Privy dependency:** Privy is the only auth/wallet layer. It has no QUAI support path (see §2.2), so the frontend wallet strategy changes on QUAI.

---

## 2. QUAI Network: constraints that shape the design

Verified against Quai docs and ecosystem sources, October 2026:

### 2.1 Network parameters

| Parameter | Mainnet | Orchard Testnet |
|---|---|---|
| Chain ID | `9` (single global ID for all shards) | `15000` |
| RPC | `https://rpc.quai.network` | `https://orchard.rpc.quai.network` |
| Explorer | Quaiscan | Quaiscan (testnet) |
| Active zone | Cyprus-1 only (address prefix `0x00`) | Cyprus-1 |
| EVM target | **London** (Solidity ≤ 0.8.20; no PUSH0/Shanghai opcodes) | London |
| SDK | `quais` (quais.js) — **required** | `quais` |
| Wallet | Pelagus (full dApp support); MetaMask Snap (sends only, no dApp tx signing) | Pelagus + faucet |

### 2.2 Hard constraints (these break naive EVM assumptions)

1. **Protobuf transactions, not RLP.** Standard ethers/viem transaction serialization does not work on QUAI. All signing, broadcasting, and receipt reads must go through **quais.js** or Pelagus's EIP-1193 provider. Our `WalletPipeline.ts` (raw EIP-1193 `eth_sendTransaction` + receipt polling) is architecturally fine, but every encoding detail must be validated against Pelagus; viem's `sendTransaction`/`encodeFunctionData` path in `page.tsx` will **not** broadcast correctly on QUAI without a quais.js-backed transport.
2. **Sharded address space.** Every address maps to a shard by its first byte. Only Cyprus-1 (`0x00…`) is active, so all participants (agency escrow, talents, clients) must use `0x00`-prefixed QUAI addresses. The talent registration flow must **validate the shard prefix** and reject addresses outside Cyprus-1 — a cross-shard payout is a stuck/lost payout.
3. **London EVM ceiling.** Vyper 0.3.10 can target `paris` (the closest safe target to London — no PUSH0). Compilation for QUAI must pin `evm_version: paris` and the deployed bytecode must be scanned for Shanghai+ opcodes (`PUSH0` 0x5f, `MCOPY`, `TSTORE/TLOAD`) before deploy. The current hardhat fork config declares Cancun from genesis — that is wrong for QUAI and must be replaced with a QUAI fork/London profile.
4. **No native USDC.** QUAI's dollar-adjacent assets are **bridged USDT** (live via Symbiosis/Quainance), **WQI** (wrapped Qi), and native **QUAI**. There is no canonical Circle USDC deployment on QUAI, so the existing USDC registry pattern becomes a **QRC-20 settlement-token registry** with a strict allowlist (bridged USDT address from Quainance, WQI — verified against Quaiscan at integration time).
5. **Contract verification needs IPFS metadata.** `@quai/hardhat-deploy-metadata` pushes metadata to IPFS; Quaiscan verification requires the CID embedded at deploy. This becomes a mandatory deploy step.

### 2.3 x402 on QUAI: the facilitator gap

x402 v2 is chain-agnostic (`eip155:9` is expressible via CAIP-2 and the `exact` scheme), and any EVM chain can be registered at runtime — but **there is no production facilitator for QUAI**, and two protocol primitives are missing on QUAI:

- **EIP-3009 `transferWithAuthorization`**: exists on USDC, not on QUAI's bridged USDT/WQI (verify per-token at integration; assume absent).
- **Permit2**: the canonical Uniswap Permit2 deployment does not exist on QUAI.

Therefore the x402-on-QUAI design is:

1. **Deploy Permit2 (or a minimal audited EIP-3009-style wrapper token vault) on QUAI Cyprus-1**, OR
2. **Use the escrow itself as the settlement target**: the x402 `exact` payload authorizes a pull into `TalentAgentQuai`, and our **self-hosted facilitator** (a quais.js service we operate) verifies signatures and settles on-chain by calling the escrow.

Option 2 is recommended: it keeps the agency's escrow model, needs no third-party token cooperation, and the facilitator is already our operational role (we are the agency). The facilitator must:

- Implement the x402 facilitator API surface (`GET /supported`, `POST /verify`, `POST /settle`) advertising `scheme: "exact"`, `network: "eip155:9"`.
- Broadcast via **quais.js** (protobuf txs) — a stock x402 facilitator cannot do this.
- Verify EIP-712 typed-data signatures off-chain (chain agnostic — works unchanged).
- Enforce replay protection (used-nonce registry), time-window checks, and shard-prefix validation on `payTo`.
- Hold a **hot settlement key** with strict limits (see §4.3).

---

## 3. Target architecture

```
Client (Pelagus / agent wallet)
   │  1. GET /api/talent/{id}/engage
   │  2. 402 PAYMENT-REQUIRED { scheme: exact, network: eip155:9,
   │       asset: <allowlisted QRC-20>, payTo: <escrow>, amount }
   │  3. Sign EIP-712 authorization (off-chain, no gas)
   ▼
BTAI Backend (FastAPI — becomes the x402 resource server)
   │  4. /verify → facilitator   5. /settle → facilitator
   ▼
BTAI x402 Facilitator (NEW — quais.js service, QUAI Cyprus-1)
   │  6. verify signature/nonce/balance/shard
   │  7. settle: escrow.create_and_deposit_authorized(...) on QUAI
   ▼
TalentAgentQuai.vy (escrow, Cyprus-1, 0x00 shard)
   │  8. Funds held; milestones released by client/oracle/agent
   ▼
Talent receive_address (validated 0x00-prefixed)
```

### 3.1 Workstream A — Contracts (`packages/contracts`)

1. **New `TalentAgentQuai.vy`** (evolve, don't fork blindly):
   - Add `settlement_token: public(address)` set once in `__init__` from an allowlist (or an `allowed_tokens` HashMap gated by owner) — closes the arbitrary-token gap.
   - Add **milestones**: `agreement_id → milestone[] {amount, released}`; `release_funds` becomes per-milestone; keep the existing partial-release semantics.
   - Add **protocol fee**: `fee_bps` (cap at e.g. 1000 = 10%), `fee_recipient`, taken on release. Fee changes behind a timelock or two-step commit.
   - Add **two-step agent transfer**: `propose_agent` / `accept_agent` (pending-agent pattern) instead of one-shot `set_agent`.
   - Add **dispute timeout**: if `funded_at + dispute_window` passes with no release, client can self-refund the unreleased remainder; before that, only agent arbitration. This removes the "silent client locks funds forever" and "silent agent" failure modes symmetrically.
   - Add `pause` (agent-only) that blocks new deposits but never blocks refunds/withdrawals of already-escrowed funds (funds-safety invariant: pause must never trap client money).
   - Keep CEI + `@nonreentrant` + truthy-return asserts exactly as they are.
2. **Compiler pin:** Vyper 0.3.10, `evm_version: paris`; post-compile opcode audit for Shanghai+ instructions; deploy-metadata CID to IPFS for Quaiscan.
3. **Tests:** replace the Base-fork USDC suite with a QUAI-profile suite:
   - Local Hardhat chain at chainId 9 semantics where possible; otherwise Orchard testnet integration tests behind `QUAI_RPC_URL` (skip-if-unset, same pattern as today).
   - Deploy a minimal QRC-20 (6 decimals, return-true) as the test settlement token — on QUAI there is no canonical token to fork, so a *pinned, reviewed* test token is acceptable here (unlike the USDC mainnet-fork rule, which exists because canonical USDC was available).
   - Port every existing test (deposit, release, refund, atomic create_and_deposit, auth) and add: milestone partial releases, fee accounting exactness, two-step agent transfer, dispute-window refund timing (boundary tests at window edges), pause invariants.

### 3.2 Workstream B — x402 facilitator (`packages/facilitator`, NEW)

- Node/TypeScript service on **quais.js**: `JsonRpcProvider(rpcUrl, undefined, { usePathing: true })`, `quais.Wallet` for the settlement key.
- x402 v2 API: `/supported`, `/verify`, `/settle` with `Idempotency-Key` support on `/settle`.
- Nonce registry in Postgres (not SQLite) with unique constraint on `(from, nonce)` — replay protection survives restarts.
- Rate limits, per-route price ceiling enforcement, structured logging, and a kill switch.
- Deployment: containerized, secrets from a manager (no `.env` on the host), settlement key in a KMS/HSM or at minimum a dedicated hot wallet with daily balance caps.

### 3.3 Workstream C — Backend (`apps/backend`)

- Become the x402 **resource server**: paid endpoints (engagement initialization, premium talent queries, agent inference) return real 402 challenges via the facilitator.
- **Fix the key leak** (§1.4) before anything else ships.
- Add **SIWE-style auth** on talent writes: talent signs a message with the same `0x00` QUAI address they register as `receive_address`; backend verifies via quais.js signature recovery.
- Migrate SQLite → Postgres when facilitator shares the DB; add migrations (Alembic).
- Add shard-prefix validation on every address field.

### 3.4 Workstream D — Frontend (`apps/frontend`)

- Replace Privy-only auth with **Pelagus-first** connection (EIP-1193 from `window.ethereum` when Pelagus is installed); keep Privy for the legacy EVM deployments only if multi-network is retained, otherwise drop it to reduce attack surface.
- Replace viem contract calls with **quais.js** encoding for QUAI routes; keep `WalletPipeline.ts` as the stage/progress shell but swap the signing/broadcast layer per network (the pipeline's stage model — resolve → switch → sign → await — survives intact).
- Replace `usdc.ts` registry with a **QUAI settlement-token registry** (label, address, decimals, verified flag, Quaiscan link); keep `usdc.ts` untouched for legacy networks.
- `DeployTalentAgent.tsx`: regenerate `talentAgent.generated.ts` from the new contract (extend `export-artifact.js`), add shard-prefix check on the deployer address before enabling the deploy button, and point explorers at Quaiscan.
- Display the dispute window, fee, and milestone schedule in the escrow UI before the client signs — informed consent is a security control.

### 3.5 Workstream E — Agent SDK / harness

- The SDK already models QUAI mining telemetry (`mining.quai`) — extend `HarnessClient` with a `QuaiSettlementController` (facilitator health, pending settlements, nonce-registry stats) so agency operations are observable from the same harness that watches mining.

---

## 4. Security & operational protocol standards

### 4.1 Smart-contract engineering gates (all mandatory before mainnet)

1. **Static analysis:** Slither-equivalent for Vyper (mythril/vyper-compile warnings) in CI; zero-warning policy.
2. **Opcode audit:** compiled bytecode scanned for Shanghai+ opcodes (London ceiling).
3. **Fork/integration tests:** full escrow lifecycle on Orchard testnet with the real settlement token before mainnet.
4. **Invariants documented and fuzzed** (Foundry-style or hardhat fuzz): (a) contract balance ≥ Σ(deposited − paid_out) across open agreements; (b) fees paid + talent paid + refundable == deposited; (c) paused state never blocks refunds.
5. **External audit** of `TalentAgentQuai.vy` before holding real value; publish the report.
6. **Deploy hygiene:** deployer key used once, agent role moved to a **multisig** (or governance) immediately post-deploy; deployment script prints and records the IPFS metadata CID for Quaiscan verification.

### 4.2 Key management

| Key | Custody | Limits |
|---|---|---|
| Contract `agent` (orchestrator) | Multisig (2-of-3 minimum), cold | Full arbitration power — treat as root |
| `fee_recipient` | Multisig or treasury contract | — |
| Facilitator settlement key | KMS/HSM-backed hot wallet | Daily spend cap, auto-pause on anomaly, balance alarm |
| Deployer | Single-use, discarded | No ongoing privileges |

### 4.3 Operational protocols

- **Secrets:** nothing in git; env-only, secret manager in prod; quarterly rotation.
- **Monitoring:** on-chain watcher for `AgreementCreated/FundsDeposited/PayoutTriggered/AgreementCancelled` reconciled against the facilitator's nonce registry; alert on any escrow-balance/accounting divergence (invariant 4.1.4a checked live).
- **Incident response:** documented runbook — pause deposits, never freeze refunds; facilitator kill switch; multisig signers' contact tree.
- **Upgrades:** contracts are intentionally non-upgradeable; migration path = deploy v2, drain nothing (escrows complete on v1), redirect `NEXT_PUBLIC_TALENT_AGENT_ADDRESS`-equivalent config.
- **Change management:** two-review PR rule on `packages/contracts` and `packages/facilitator`; CI runs tests + static analysis + opcode scan on every PR.

---

## 5. Phased roadmap

| Phase | Deliverable | Gate to proceed |
|---|---|---|
| **0. Hygiene** (now) | Remove leaked-key integration; auth on talent writes; address validation | **Done 2026-10-19** — the third-party report integration (with its hardcoded key) was removed from the repo entirely at the owner's decision; SIWE auth on talent writes and shard-prefix validation landed |
| **1. Contract** | `TalentAgentQuai.vy` (milestones, fee, 2-step agent, dispute window, pause, token allowlist, EIP-712 gasless settlement) + full test suite | **Done 2026-10-19**: Vyper 0.3.10 `evm_version: paris`, bytecode verified free of Shanghai+ opcodes, **32/32 Hardhat tests green**, **10/10 Foundry fuzz+invariant tests green** (512 fuzz runs), **Slither clean** on the Solidity helper (0 findings, solc 0.8.24 Paris) |
| **2. Testnet** | Deploy on Orchard (chainId 15000); Quaiscan verified; frontend pointed at testnet | **Done 2026-10-19**: escrow `0x0042bc0BBbe34FBa82a52Cce6a2792DaA87c484C`, test token `0x0043a6b95A33A5Ac6ece32A4C172AE83390c2C59` (deployment record `packages/contracts/deployments/orchard-*.json`) |
| **3. Facilitator** | `packages/facilitator` live on Orchard; backend serves real 402s; Pelagus E2E payment | **Done 2026-10-19**: facilitator (13/13 vitest), backend x402 resource server + SIWE auth (9/9 pytest), frontend gasless Pelagus flow (webpack build green); **live E2E proven on Orchard** — full gasless flow (fresh client → mint → approve → EIP-712 signature → agent `create_and_deposit_for` → milestone release) mined and verified on-chain, exact 2.5% fee split (`scripts/smoke-test-orchard.js`) |
| **4. Audit** | External audit of contract + facilitator crypto path; fix findings | **Waived by owner 2026-10-19** — deployed without external audit; internal gates held (Slither clean, 32/32 Hardhat, 10/10 Foundry fuzz+invariant). Real-value exposure should stay capped until an audit happens |
| **5. Mainnet** | Deploy on Cyprus-1 (chainId 9), agent→multisig, monitoring live, facilitator with capped hot key | **Deployed 2026-10-19**: escrow `0x00558035cfFAa4766A7f77cA987650711bDaF7a6`, settlement token = official Symbiosis bridged USDT `0x0049F7cbCa3556C2DfaE62Aafa7015F99de1b8f5` (verified on-chain: symbol USDT, 6 decimals, allowlisted; EIP-712 domain separator matches spec). Deployment record `packages/contracts/deployments/cyprus1-*.json`. **Owner to-dos open:** agent key → multisig, monitoring, facilitator hot-key caps |

---

## 5.1 Deployed instances (2026-10-19)

| Network | Chain ID | Escrow (`TalentAgentQuai`) | Settlement token | Fee |
|---|---|---|---|---|
| Orchard testnet | 15000 | `0x0042bc0BBbe34FBa82a52Cce6a2792DaA87c484C` | `0x0043a6b95A33A5Ac6ece32A4C172AE83390c2C59` (TestSettlementToken, mintable) | 250 bps |
| Mainnet Cyprus-1 | 9 | `0x00558035cfFAa4766A7f77cA987650711bDaF7a6` | `0x0049F7cbCa3556C2DfaE62Aafa7015F99de1b8f5` (bridged USDT) | 250 bps |

Agent/deployer address on both networks: `0x003279113881A8a0E3920078D8A1e4776a54db4e` (key in `packages/contracts/.env.quai-deploy`, gitignored — move the mainnet `agent` role to a multisig before real value flows).

## 5.2 QUAI chain quirks (hard-won operational knowledge)

1. **QUAI vs Qi ledger bit.** The second byte of the address selects the ledger: `< 0x80` = QUAI (EVM) account, `≥ 0x80` = Qi (UTXO). Faucets and contract calls reject Qi addresses. All four address-validation points (frontend `quai.ts`, `deploy-quai.js`, facilitator, backend `auth.py`) enforce this.
2. **Never attach an explicit EMPTY access list to a legacy QUAI transaction.** go-quai's *mined* execution burns the entire gas limit (INVALID-style, no revert data) for type-0 txs with `accessList: []`, while `eth_call` of the identical input/state succeeds. Leaving the field unset (quais populates a real access list via `eth_createAccessList`) mines correctly. This cost three failed settles (600k / 2M / 10M gas, all fully burned) to isolate; the facilitator and smoke test carry the workaround and comments.
3. **quais tx building:** use `new quais.QuaiTransaction(from)` and set `.to/.value/.data/.gasLimit` — a plain object to `Wallet.sendTransaction` throws "unsupported addressable value".
4. **Low-s normalization:** quais `SigningKey.sign` does not normalize s; Vyper `ecrecover` enforces EIP-2 and rejects high-s. Normalize client-side (production wallets already do).
5. **`eth_call`/`estimateGas` execute against a lagging snapshot** — a fresh approval may not be visible; treat static-call failures on Orchard as inconclusive and let the mined receipt be the verdict (but see quirk 2: pin the gas limit and let quais build the access list).
6. **Contract deploys require a 46-char IPFS metadata CID** (quais enforces it); `deploy-quai.js` pushes metadata to `https://ipfs.qu.ai` automatically via `kubo-rpc-client`.
| **6. Agency ops** | Talent onboarding with SIWE auth, milestone templates, harness observability | First real settlement reconciled |

---

## 6. Open decisions for the owner

1. **Settlement asset priority:** bridged USDT (dollar-stable, familiar to clients) vs WQI (native energy-dollar narrative) vs both (allowlist). Recommend USDT-first, WQI second.
2. **Fee model:** bps on release vs flat listing fee; cap recommendation ≤ 10%.
3. **Dispute window length:** recommend 14 days default, per-agreement override within [3, 30] days.
4. **Multi-network posture:** keep Base USDC rail alongside QUAI (registry already supports it) or QUAI-exclusive. Keeping both is nearly free given the registry pattern.
