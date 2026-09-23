import { AIResponseState } from '@/shared/constants';
import { ResponseValidator } from './response-validator';
import type { LLMResponse } from '@/modules/ai/providers/llm.provider';

function response(partial: Partial<LLMResponse>): LLMResponse {
  return {
    parsed: null,
    rawText: null,
    stopReason: 'end_turn',
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    latencyMs: 1,
    model: 'test',
    ...partial,
  };
}

describe('ResponseValidator', () => {
  const validator = new ResponseValidator();

  it('accepts a well-formed structured response', () => {
    const result = validator.validate(
      response({ parsed: { state: AIResponseState.Answered, message: 'สวัสดีครับ' } }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.state).toBe(AIResponseState.Answered);
    }
  });

  it('rejects a response with no parsed output', () => {
    // Raw text is unvalidated model output; salvaging it would bypass every
    // guarantee the schema exists to provide.
    const result = validator.validate(response({ parsed: null, rawText: 'some prose' }));
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown state', () => {
    const result = validator.validate(
      response({ parsed: { state: 'SOMETHING_ELSE', message: 'hi' } as never }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an empty message', () => {
    const result = validator.validate(
      response({ parsed: { state: AIResponseState.Answered, message: '' } }),
    );
    expect(result.ok).toBe(false);
  });

  it('accepts HANDOFF with an internal reason', () => {
    const result = validator.validate(
      response({
        parsed: {
          state: AIResponseState.Handoff,
          message: 'ขอส่งต่อให้ทีมงานครับ',
          handoffReason: 'no pricing data available',
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.handoffReason).toBe('no pricing data available');
    }
  });
});
