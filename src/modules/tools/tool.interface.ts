import type { z } from 'zod';

/**
 * Context supplied by the orchestrator (master plan §25).
 *
 * **`organizationId` comes from here, never from the model.** The model
 * chooses the tool and its arguments; it cannot choose whose data those
 * arguments address. That single rule is the entire defence against a
 * prompt-injected cross-tenant read.
 */
export interface ToolContext {
  organizationId: string;
  conversationId: string;
  customerId: string;
  requestId: string;
}

export interface AITool<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  /**
   * Zod is the single source of truth. The JSON Schema advertised to the
   * model is *derived* from it, so the contract the model sees and the
   * contract that is enforced cannot drift apart.
   */
  readonly inputSchema: z.ZodType<TInput>;
  /** True → human approval required before execution (§25). */
  readonly mutating: boolean;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
}
