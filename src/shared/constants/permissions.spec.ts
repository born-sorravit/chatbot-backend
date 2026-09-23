import {
  ALL_PERMISSIONS,
  Permission,
  ROLE_PERMISSIONS,
  resolvePermissions,
  UserRole,
} from './permissions';

describe('RBAC permission resolution', () => {
  it('gives OWNER every permission in the catalogue', () => {
    const resolved = resolvePermissions(UserRole.Owner);
    expect(resolved).toHaveLength(ALL_PERMISSIONS.length);
    expect(new Set(resolved)).toEqual(new Set(ALL_PERMISSIONS));
  });

  it('denies AGENT the write permissions ADMIN holds', () => {
    const agent = resolvePermissions(UserRole.Agent);

    expect(agent).not.toContain(Permission.KnowledgeWrite);
    expect(agent).not.toContain(Permission.AiWrite);
    expect(agent).not.toContain(Permission.UserRead);
    expect(agent).not.toContain(Permission.UserWrite);
  });

  it('lets AGENT do the conversation work the inbox needs', () => {
    const agent = resolvePermissions(UserRole.Agent);

    expect(agent).toContain(Permission.ConversationRead);
    expect(agent).toContain(Permission.ConversationReply);
    expect(agent).toContain(Permission.ConversationTakeover);
    expect(agent).toContain(Permission.ConversationClose);
  });

  it('denies ADMIN the owner-only settings and user writes', () => {
    const admin = resolvePermissions(UserRole.Admin);

    expect(admin).toContain(Permission.UserRead);
    expect(admin).not.toContain(Permission.UserWrite);
    expect(admin).not.toContain(Permission.SettingsWrite);
  });

  it('adds explicit per-user grants on top of the role baseline', () => {
    const resolved = resolvePermissions(UserRole.Agent, [Permission.KnowledgeWrite]);

    expect(resolved).toContain(Permission.KnowledgeWrite);
    // The baseline survives — extra grants add, never replace.
    expect(resolved).toContain(Permission.ConversationRead);
  });

  it('drops unknown permission strings instead of trusting them', () => {
    // A hand-edited or stale database row must not be able to invent a
    // capability the catalogue does not define.
    const resolved = resolvePermissions(UserRole.Agent, [
      'billing.refund_everything',
      '*',
      Permission.AiWrite,
    ]);

    expect(resolved).not.toContain('billing.refund_everything');
    expect(resolved).not.toContain('*');
    expect(resolved).toContain(Permission.AiWrite);
  });

  it('never lets an extra grant revoke a role permission', () => {
    const baseline = ROLE_PERMISSIONS[UserRole.Agent];
    const resolved = resolvePermissions(UserRole.Agent, []);

    for (const permission of baseline) {
      expect(resolved).toContain(permission);
    }
  });

  it('returns a stable, sorted, duplicate-free set', () => {
    const resolved = resolvePermissions(UserRole.Admin, [
      Permission.ConversationRead,
      Permission.ConversationRead,
    ]);

    expect(resolved).toEqual([...resolved].sort());
    expect(new Set(resolved).size).toBe(resolved.length);
  });
});
