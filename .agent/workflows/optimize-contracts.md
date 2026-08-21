# Workflow: Vyper Smart Contract Gas Optimization

This workflow provides optimizations to minimize contract deployment and execution transaction gas costs for `TalentAgent.vy`.

---

## 1. Storage Slot Optimization

In Vyper, storage access (`SSTORE`/`SLOAD`) is the most expensive operation. Pack struct variables to minimize storage layout boundaries.

### Steps:
1. Locate `packages/contracts/contracts/TalentAgent.vy`.
2. Inspect the `Agreement` struct:
   ```vyper
   struct Agreement:
       talent: address     # 20 bytes
       client: address     # 20 bytes
       token: address      # 20 bytes
       amount: uint256     # 32 bytes
       deposited: uint256  # 32 bytes
       paid_out: uint256   # 32 bytes
       status: uint256     # 32 bytes (only values 0-3 used)
   ```
3. Optimize struct packing by reducing `status` to `uint8` or `uint16` to enable compiler slot packing, and rearrange storage elements sequentially:
   ```vyper
   struct Agreement:
       talent: address
       client: address
       token: address
       status: uint8       # Packed alongside addresses into fewer slots
       amount: uint256
       deposited: uint256
       paid_out: uint256
   ```

---

## 2. Inlining & Internal Functions

Inline trivial getters and use `@internal` visibility tags to limit public dispatch overhead for internal math/validation routines.

### Steps:
1. Replace repetitive authorization assertions with a centralized helper:
   ```vyper
   @internal
   @view
   def _assert_is_agent():
       assert msg.sender == self.agent, "Unauthorized agent"
   ```
