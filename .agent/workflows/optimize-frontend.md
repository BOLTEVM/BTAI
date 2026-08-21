# Workflow: Optimizing and Improving the Frontend Client

This workflow details optimization strategies for the frontend client interface (`apps/frontend`), focusing on component rendering, network efficiency, and state sync.

---

## 1. Batching RPC State Queries

Reduce HTTP/WebSocket request frequency by batching individual queries (e.g., retrieving active agents, fetching balances, and polling task queues) into singular composite state payloads.

### Steps:
1. Locate `apps/frontend/src/app/page.tsx`.
2. Consolidate separate state requests into a single batch call `fetchUnifiedDashboardState`:
   ```typescript
   const fetchDashboard = async () => {
     const response = await fetch(`${API_BASE_URL}/dashboard-state`)
     if (!response.ok) throw new Error('Dashboard state retrieval failed')
     const data = await response.json()
     
     setAgents(data.agents)
     setPendingTasks(data.tasks)
     setSystemHealth(data.health)
   }
   ```

---

## 2. Dynamic Component Lazy Loading

Optimize Next.js bundle sizes and initial page loads by dynamic-loading floating panels (such as the Chat Overlay, Audit Log Explorer, and Escrow configurators) that are not needed on initial layout render.

### Steps:
1. Identify non-critical elements in `apps/frontend/src/app/page.tsx` (e.g., `<EscrowSettingsModal>`, `<ChatPortal>`).
2. Replace standard imports with Next.js dynamic imports:
   ```typescript
   import dynamic from 'next/dynamic'

   const ChatPortal = dynamic(() => import('../components/ChatPortal'), {
     loading: () => <p>Loading Chat...</p>,
     ssr: false
   })
   ```

---

## 3. Web3 Contract Event Listeners

Optimize interaction loops with the Vyper contract (`TalentAgent.vy`) by listening directly to EVM events rather than polling RPC states for transaction confirmation.

### Steps:
1. Listen for `AgreementCreated`, `FundsDeposited`, and `PayoutTriggered` events:
   ```typescript
   const contract = new ethers.Contract(address, abi, provider)
   contract.on('FundsDeposited', (agreementId, amount) => {
     console.log(`Agreement ${agreementId} funded with ${amount} USDC`)
     fetchTalents()
   })
   ```
