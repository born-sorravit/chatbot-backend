import { z } from 'zod';
import { AIResponseState } from '@/shared/constants';

/**
 * Structured output contract (docs/ARCHITECTURE.md §6.5).
 *
 * Shared by the Anthropic provider (as the response format handed to the
 * model) and by ResponseValidator (as the parse target), so the advertised
 * contract and the validated contract cannot drift apart.
 */
export const aiResponseSchema = z.object({
  state: z.enum([
    AIResponseState.Answered,
    AIResponseState.NeedMoreInformation,
    AIResponseState.ToolRequired,
    AIResponseState.Handoff,
  ]),
  /** The only field ever shown to a customer or an admin. */
  message: z.string().min(1).max(4000),
  /** Internal, admin-only. Explains why the AI gave up. */
  handoffReason: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type AiResponsePayload = z.infer<typeof aiResponseSchema>;
