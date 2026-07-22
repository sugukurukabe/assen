/**
 * 5系統状態機械（§5）：content/execution/delivery/ledger/retentionの許容遷移を定義する。
 * 不正遷移はInvalidTransitionErrorで拒否し、audit_eventsに記録可能な形にする
 * The five independent status tracks (§5): defines allowed transitions for content/execution/delivery/ledger/retention.
 * Invalid transitions are rejected with InvalidTransitionError so they remain recordable in audit_events
 * Lima jalur status independen (§5): mendefinisikan transisi yang diizinkan untuk content/execution/delivery/ledger/retention.
 * Transisi tidak valid ditolak dengan InvalidTransitionError sehingga tetap dapat direkam di audit_events
 */
import { InvalidTransitionError } from "../../lib/errors.js";

type ContentStatus = "draft" | "under_review" | "approved" | "superseded" | "voided";
type ExecutionStatus = "unsigned" | "partially_signed" | "executed";
type DeliveryStatus = "not_sent" | "queued" | "sent" | "delivered" | "failed";
type LedgerStatus = "unposted" | "posted" | "corrected";
type RetentionStatus = "active" | "eligible_for_deletion" | "legal_hold" | "deleted";

const CONTENT_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  draft: ["under_review", "voided"],
  under_review: ["approved", "draft", "voided"],
  approved: ["superseded", "voided"],
  superseded: [],
  voided: [],
};

const EXECUTION_TRANSITIONS: Record<ExecutionStatus, ExecutionStatus[]> = {
  unsigned: ["partially_signed", "executed"],
  partially_signed: ["executed"],
  executed: [],
};

const DELIVERY_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  not_sent: ["queued"],
  queued: ["sent", "failed"],
  sent: ["delivered", "failed"],
  delivered: [],
  failed: ["queued"],
};

const LEDGER_TRANSITIONS: Record<LedgerStatus, LedgerStatus[]> = {
  unposted: ["posted"],
  posted: ["corrected"],
  corrected: ["corrected"],
};

const RETENTION_TRANSITIONS: Record<RetentionStatus, RetentionStatus[]> = {
  active: ["eligible_for_deletion", "legal_hold"],
  eligible_for_deletion: ["deleted", "legal_hold"],
  legal_hold: ["active", "eligible_for_deletion"],
  deleted: [],
};

function assertTransition<T extends string>(track: string, transitions: Record<T, T[]>, from: T, to: T): void {
  if (from === to) {
    return;
  }
  const allowed = transitions[from] ?? [];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(
      `${track}の不正な遷移です（${from} → ${to}） / Invalid ${track} transition (${from} -> ${to})`,
    );
  }
}

export function assertContentTransition(from: ContentStatus, to: ContentStatus): void {
  assertTransition("content_status", CONTENT_TRANSITIONS, from, to);
}

export function assertExecutionTransition(from: ExecutionStatus, to: ExecutionStatus): void {
  assertTransition("execution_status", EXECUTION_TRANSITIONS, from, to);
}

export function assertDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): void {
  assertTransition("delivery_status", DELIVERY_TRANSITIONS, from, to);
}

export function assertLedgerTransition(from: LedgerStatus, to: LedgerStatus): void {
  assertTransition("ledger_status", LEDGER_TRANSITIONS, from, to);
}

export function assertRetentionTransition(from: RetentionStatus, to: RetentionStatus): void {
  assertTransition("retention_status", RETENTION_TRANSITIONS, from, to);
}
