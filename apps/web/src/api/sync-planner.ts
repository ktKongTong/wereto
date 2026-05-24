import type { SyncStage } from "./sync-work.ts";

const FREE_WORKER_SUBREQUEST_LIMIT = 50;

// Keep budget ownership here. The runtime does not expose remaining subrequests,
// so each queue invocation gets one conservative app-level allowance.
const RESERVED_SUBREQUESTS: Partial<Record<SyncStage, number>> = {
  "reading-periods": 22,
  "reading-years": 22,
  "reading-days": 24,
  "book-details": 22,
  "notebook-content": 24,
};

const ITEM_SUBREQUEST_COST: Partial<Record<SyncStage, number>> = {
  "reading-periods": 10,
  "reading-years": 10,
  "reading-days": 28,
  "book-details": 14,
  "notebook-content": 24,
};

const LOGICAL_CHUNK_SIZE: Partial<Record<SyncStage, number>> = {
  "reading-periods": 24,
  "reading-years": 8,
  "reading-days": 1,
  "book-details": 20,
  "notebook-content": 16,
};

export type SubrequestBudget = {
  readonly remaining: number;
  takeItems(stage: SyncStage, requested: number): number;
};

export function createSubrequestBudget(stage: SyncStage): SubrequestBudget {
  let remaining = Math.max(1, FREE_WORKER_SUBREQUEST_LIMIT - (RESERVED_SUBREQUESTS[stage] ?? 40));

  return {
    get remaining() {
      return remaining;
    },
    takeItems(targetStage, requested) {
      if (requested <= 0) return 0;
      const itemCost = ITEM_SUBREQUEST_COST[targetStage] ?? remaining;
      const count = Math.max(1, Math.min(requested, Math.floor(remaining / itemCost)));
      remaining = Math.max(0, remaining - count * itemCost);
      return count;
    },
  };
}

export function planLogicalChunkSize(stage: SyncStage) {
  return LOGICAL_CHUNK_SIZE[stage] ?? 1;
}

export function planInvocationItemCount(stage: SyncStage, requested: number) {
  return createSubrequestBudget(stage).takeItems(stage, requested);
}
