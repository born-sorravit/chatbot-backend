import { z } from 'zod';
import { ToolExecutionStatus } from '@/shared/constants';
import { ToolService } from './tool.service';
import type { AITool, ToolContext } from './tool.interface';

const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG = '22222222-2222-2222-2222-222222222222';
const AGENT = '33333333-3333-3333-3333-333333333333';

const context: ToolContext = {
  organizationId: ORG,
  conversationId: 'conv-1',
  customerId: 'cust-1',
  requestId: 'req-1',
};

function makeService(options: {
  tools: AITool[];
  linked?: { aiToolId: string; requiresApproval?: boolean }[];
  rows?: { id: string; name: string; description?: string }[];
}) {
  const saved: Record<string, unknown>[] = [];

  const executions = {
    create: (row: Record<string, unknown>) => row,
    save: (row: Record<string, unknown>) => {
      const stored = { id: `exec-${saved.length + 1}`, ...row };
      saved.push(stored);
      return Promise.resolve(stored);
    },
  };

  const service = new ToolService(
    options.tools[0] as never,
    options.tools[1] as never,
    options.tools[2] as never,
    { record: jest.fn().mockResolvedValue(undefined) } as never,
    { find: () => Promise.resolve(options.rows ?? []) } as never,
    {
      find: () =>
        Promise.resolve(
          (options.linked ?? []).map((link) => ({
            aiToolId: link.aiToolId,
            aiAgentId: AGENT,
            organizationId: ORG,
            enabled: true,
            requiresApproval: link.requiresApproval ?? false,
          })),
        ),
    } as never,
    executions as never,
  );

  return { service, saved };
}

function tool(overrides: Partial<AITool> & { name: string }): AITool {
  return {
    description: 'test tool',
    inputSchema: z.object({ q: z.string().min(1) }),
    mutating: false,
    execute: jest.fn().mockResolvedValue({ ok: 1 }),
    ...overrides,
  } as AITool;
}

describe('ToolService', () => {
  it('rejects a tool that is not in the code registry', async () => {
    // A database row cannot introduce a capability (§25).
    const known = tool({ name: 'getProduct' });
    const { service } = makeService({ tools: [known, known, known] });

    const result = await service.execute(ORG, AGENT, 'deleteEverything', {}, context);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Unknown tool');
  });

  it('rejects a registered tool that the agent is not allowed to use', async () => {
    const known = tool({ name: 'getProduct' });
    // Registered in code, but no allowlist row for this agent.
    const { service, saved } = makeService({ tools: [known, known, known], linked: [] });

    const result = await service.execute(ORG, AGENT, 'getProduct', { q: 'x' }, context);

    expect(result.ok).toBe(false);
    expect(known.execute).not.toHaveBeenCalled();
    // Rejections are logged — "the AI tried something it could not do" is
    // exactly the entry worth finding later.
    expect(saved.at(-1)?.status).toBe(ToolExecutionStatus.Rejected);
  });

  it('rejects input that fails the tool schema, without executing', async () => {
    const known = tool({ name: 'getProduct' });
    const { service, saved } = makeService({
      tools: [known, known, known],
      linked: [{ aiToolId: 't1' }],
      rows: [{ id: 't1', name: 'getProduct' }],
    });

    const result = await service.execute(ORG, AGENT, 'getProduct', { q: '' }, context);

    expect(result.ok).toBe(false);
    expect(known.execute).not.toHaveBeenCalled();
    expect(saved.at(-1)?.status).toBe(ToolExecutionStatus.Failed);
  });

  it('executes an allowed tool with validated input', async () => {
    const known = tool({ name: 'getProduct' });
    const { service, saved } = makeService({
      tools: [known, known, known],
      linked: [{ aiToolId: 't1' }],
      rows: [{ id: 't1', name: 'getProduct' }],
    });

    const result = await service.execute(ORG, AGENT, 'getProduct', { q: 'iphone' }, context);

    expect(result.ok).toBe(true);
    expect(known.execute).toHaveBeenCalledWith({ q: 'iphone' }, context);
    expect(saved.at(-1)?.status).toBe(ToolExecutionStatus.Success);
  });

  it('passes organizationId from the context, never from model input', async () => {
    // The model picks the tool and its arguments; it cannot pick whose data
    // those arguments address. This is the whole defence against a
    // prompt-injected cross-tenant read.
    const known = tool({ name: 'getProduct', inputSchema: z.object({ q: z.string() }).passthrough() as never });
    const { service } = makeService({
      tools: [known, known, known],
      linked: [{ aiToolId: 't1' }],
      rows: [{ id: 't1', name: 'getProduct' }],
    });

    await service.execute(
      ORG,
      AGENT,
      'getProduct',
      { q: 'x', organizationId: OTHER_ORG },
      context,
    );

    const [, passedContext] = (known.execute as jest.Mock).mock.calls[0];
    expect(passedContext.organizationId).toBe(ORG);
  });

  it('holds a mutating tool for approval instead of running it', async () => {
    const mutating = tool({ name: 'getProduct', mutating: true });
    const { service, saved } = makeService({
      tools: [mutating, mutating, mutating],
      linked: [{ aiToolId: 't1' }],
      rows: [{ id: 't1', name: 'getProduct' }],
    });

    const result = await service.execute(ORG, AGENT, 'getProduct', { q: 'x' }, context);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.pendingApproval).toBe(true);
    expect(mutating.execute).not.toHaveBeenCalled();
    expect(saved.at(-1)?.status).toBe(ToolExecutionStatus.PendingApproval);
  });

  it('honours a per-agent approval requirement on a non-mutating tool', async () => {
    const known = tool({ name: 'getProduct' });
    const { service } = makeService({
      tools: [known, known, known],
      linked: [{ aiToolId: 't1', requiresApproval: true }],
      rows: [{ id: 't1', name: 'getProduct' }],
    });

    const result = await service.execute(ORG, AGENT, 'getProduct', { q: 'x' }, context);

    expect(result.ok).toBe(false);
    expect(known.execute).not.toHaveBeenCalled();
  });

  it('never leaks an internal error message to the model', async () => {
    const failing = tool({
      name: 'getProduct',
      execute: jest.fn().mockRejectedValue(new Error('connection to 10.0.0.5 refused')),
    });
    const { service, saved } = makeService({
      tools: [failing, failing, failing],
      linked: [{ aiToolId: 't1' }],
      rows: [{ id: 't1', name: 'getProduct' }],
    });

    const result = await service.execute(ORG, AGENT, 'getProduct', { q: 'x' }, context);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain('10.0.0.5');
      expect(result.error).toContain('could not retrieve');
    }
    // The detail is kept in the log, where an operator can find it.
    expect(String(saved.at(-1)?.errorMessage)).toContain('10.0.0.5');
  });

  it('derives the advertised JSON Schema from the tool Zod schema', async () => {
    const known = tool({
      name: 'getProduct',
      inputSchema: z.object({ q: z.string().describe('what to search for') }),
    });
    const { service } = makeService({
      tools: [known, known, known],
      linked: [{ aiToolId: 't1' }],
      rows: [{ id: 't1', name: 'getProduct', description: '' }],
    });

    const [definition] = await service.definitionsForAgent(ORG, AGENT);

    // Same object the validator uses, so advertised and enforced cannot drift.
    expect(definition.inputSchema).toMatchObject({
      type: 'object',
      required: ['q'],
      additionalProperties: false,
    });
  });
});
