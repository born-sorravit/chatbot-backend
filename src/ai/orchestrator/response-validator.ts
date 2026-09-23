import { Injectable, Logger } from '@nestjs/common';
import { aiResponseSchema, type AiResponsePayload } from '../providers/response.schema';
import type { LLMResponse } from '../providers/llm.provider';

export type ValidationResult =
  | { ok: true; payload: AiResponsePayload }
  | { ok: false; reason: string };

/**
 * Validates structured model output (docs/ARCHITECTURE.md §6.5).
 *
 * A parse failure is treated as a provider error, not as something to
 * salvage: the raw text is unvalidated model output and rendering it would
 * bypass every guarantee the schema exists to give — including that internal
 * reasoning never reaches a customer.
 */
@Injectable()
export class ResponseValidator {
  private readonly logger = new Logger(ResponseValidator.name);

  validate(response: LLMResponse): ValidationResult {
    if (!response.parsed) {
      this.logger.warn({
        event: 'ai.response_unparseable',
        stopReason: response.stopReason,
        // Length only — the text itself may contain customer data.
        rawLength: response.rawText?.length ?? 0,
      });
      return { ok: false, reason: 'Model returned no parseable structured output' };
    }

    const result = aiResponseSchema.safeParse(response.parsed);

    if (!result.success) {
      this.logger.warn({
        event: 'ai.response_schema_invalid',
        issues: result.error.issues.map((issue) => issue.path.join('.')),
      });
      return { ok: false, reason: 'Model output failed schema validation' };
    }

    return { ok: true, payload: result.data };
  }
}
