import type { Request } from 'express';
import type { UserRole, PermissionValue } from '../constants/permissions';

/**
 * The authenticated principal, assembled by the auth guard from a *verified*
 * token. `organizationId` originates here and nowhere else — never from a
 * body, query string, or path parameter (docs/DATABASE.md §4, layer 2).
 */
export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: UserRole;
  permissions: PermissionValue[];
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  requestId: string;
}

export interface MaybeAuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  requestId: string;
}

/**
 * A customer authenticated by an anonymous session token (TD-09).
 *
 * Deliberately a different shape from AuthenticatedUser: a customer has no
 * role and no permissions, and `conversationId` scopes the token to exactly
 * one conversation rather than the whole organization.
 */
export interface AuthenticatedCustomer {
  customerId: string;
  organizationId: string;
  sessionId: string;
}

export interface CustomerRequest extends Request {
  customer: AuthenticatedCustomer;
  requestId: string;
}
