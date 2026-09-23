/**
 * Permission catalogue (master plan §9).
 *
 * Permissions are strings so the set can grow without a migration.
 * A user's effective permissions are `ROLE_PERMISSIONS[role]` unioned with
 * their per-user `permissions` column — the column grants extra rights, it
 * never revokes what the role gives.
 */
export const Permission = {
  ConversationRead: 'conversation.read',
  ConversationReply: 'conversation.reply',
  ConversationTakeover: 'conversation.takeover',
  ConversationClose: 'conversation.close',

  KnowledgeRead: 'knowledge.read',
  KnowledgeWrite: 'knowledge.write',

  AiRead: 'ai.read',
  AiWrite: 'ai.write',

  SettingsRead: 'settings.read',
  SettingsWrite: 'settings.write',

  UserRead: 'user.read',
  UserWrite: 'user.write',
} as const;

export type PermissionValue = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: readonly PermissionValue[] = Object.values(Permission);

export enum UserRole {
  Owner = 'OWNER',
  Admin = 'ADMIN',
  Agent = 'AGENT',
}

const AGENT_PERMISSIONS: readonly PermissionValue[] = [
  Permission.ConversationRead,
  Permission.ConversationReply,
  Permission.ConversationTakeover,
  Permission.ConversationClose,
  Permission.KnowledgeRead,
  Permission.AiRead,
];

const ADMIN_PERMISSIONS: readonly PermissionValue[] = [
  ...AGENT_PERMISSIONS,
  Permission.KnowledgeWrite,
  Permission.AiWrite,
  Permission.SettingsRead,
  Permission.UserRead,
];

/** OWNER gets everything, including user management and settings writes. */
const OWNER_PERMISSIONS: readonly PermissionValue[] = ALL_PERMISSIONS;

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly PermissionValue[]>> = {
  [UserRole.Owner]: OWNER_PERMISSIONS,
  [UserRole.Admin]: ADMIN_PERMISSIONS,
  [UserRole.Agent]: AGENT_PERMISSIONS,
};

/**
 * Effective permission set: role baseline ∪ explicit per-user grants.
 *
 * Unknown strings in `extra` are dropped rather than trusted — a stale or
 * hand-edited database row must not be able to invent a permission that the
 * catalogue does not define.
 */
export function resolvePermissions(
  role: UserRole,
  extra: readonly string[] = [],
): PermissionValue[] {
  const known = new Set<string>(ALL_PERMISSIONS);
  const effective = new Set<PermissionValue>(ROLE_PERMISSIONS[role]);

  for (const permission of extra) {
    if (known.has(permission)) {
      effective.add(permission as PermissionValue);
    }
  }

  return [...effective].sort();
}
