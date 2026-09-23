/** AI tool calling (master plan §24–§26). */

export enum ToolExecutionStatus {
  PendingApproval = 'PENDING_APPROVAL',
  Approved = 'APPROVED',
  Rejected = 'REJECTED',
  Running = 'RUNNING',
  Success = 'SUCCESS',
  Failed = 'FAILED',
}

export enum OrderStatus {
  Pending = 'PENDING',
  Paid = 'PAID',
  Processing = 'PROCESSING',
  Shipped = 'SHIPPED',
  Delivered = 'DELIVERED',
  Cancelled = 'CANCELLED',
  Refunded = 'REFUNDED',
}

/** The three MVP tools (§24). All read-only. */
export const TOOL_NAMES = {
  GetProduct: 'getProduct',
  GetProductStock: 'getProductStock',
  GetOrderStatus: 'getOrderStatus',
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

/**
 * How many times the orchestrator will loop tool-call → result → model.
 *
 * Without a cap a model that keeps requesting tools burns tokens until
 * `max_tokens` stops it. On exceeding this the orchestrator degrades to
 * HANDOFF rather than answering without the data it was trying to fetch
 * (docs/ARCHITECTURE.md §6.4).
 */
export const MAX_TOOL_ITERATIONS = 3;
