import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { UsersRepository } from '../users/users.repository';
import { UsersService } from '../users/users.service';
import { TokenService } from './token.service';
import type { UserEntity } from '../database/entities';
import type { PermissionValue, UserRole } from '../common/constants';

export interface AuthContext {
  userAgent?: string | null;
  ip?: string | null;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    organizationId: string;
    permissions: PermissionValue[];
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly usersService: UsersService,
    private readonly tokens: TokenService,
  ) {}

  private invalidCredentials(): never {
    throw new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  }

  /**
   * Every failure path — unknown email, wrong password, deactivated account —
   * returns the same INVALID_CREDENTIALS error. Distinguishing them would turn
   * this endpoint into a user-enumeration oracle (docs/API.md §1).
   *
   * A dummy verify runs when the user is not found so the response time does
   * not reveal whether the address exists.
   */
  async login(email: string, password: string, organizationSlug: string | undefined, context: AuthContext): Promise<AuthResult> {
    const user = await this.users.findForLogin(email, organizationSlug);

    if (!user) {
      await this.usersService.verifyPassword(
        '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000',
        password,
      );
      this.invalidCredentials();
    }

    const passwordMatches = await this.usersService.verifyPassword(user.passwordHash, password);

    if (!passwordMatches || !user.isActive) {
      this.invalidCredentials();
    }

    await this.users.markLoggedIn(user.id);
    this.logger.log({ event: 'auth.login', userId: user.id, organizationId: user.organizationId });

    return this.issue(user, null, context);
  }

  /**
   * Rotating refresh (docs/API.md §1).
   *
   * Presenting an already-revoked token means it was captured and replayed,
   * so the entire family is revoked rather than just the presented member.
   */
  async refresh(refreshToken: string, context: AuthContext): Promise<AuthResult> {
    const stored = await this.tokens.findValidRefreshToken(refreshToken);

    if (!stored) {
      throw new UnauthorizedException({
        code: 'INVALID_SESSION',
        message: 'Invalid refresh token',
      });
    }

    if (stored.revokedAt) {
      await this.tokens.revokeFamily(stored.familyId);
      this.logger.warn({
        event: 'auth.refresh_replay_detected',
        userId: stored.userId,
        familyId: stored.familyId,
      });
      throw new UnauthorizedException({
        code: 'INVALID_SESSION',
        message: 'Refresh token has been revoked',
      });
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({
        code: 'TOKEN_EXPIRED',
        message: 'Refresh token has expired',
      });
    }

    const user = await this.users.findActiveById(stored.userId);

    if (!user) {
      await this.tokens.revokeFamily(stored.familyId);
      throw new UnauthorizedException({
        code: 'INVALID_SESSION',
        message: 'User no longer active',
      });
    }

    await this.tokens.revokeToken(stored.id);

    return this.issue(user, stored.familyId, context);
  }

  async logout(refreshToken: string | undefined, userId: string): Promise<void> {
    if (refreshToken) {
      const stored = await this.tokens.findValidRefreshToken(refreshToken);
      if (stored && stored.userId === userId) {
        await this.tokens.revokeFamily(stored.familyId);
        this.logger.log({ event: 'auth.logout', userId });
        return;
      }
    }

    // No usable token presented — revoke everything for this user rather than
    // silently succeeding. Logout should always end sessions.
    await this.tokens.revokeAllForUser(userId);
    this.logger.log({ event: 'auth.logout_all', userId });
  }

  private async issue(
    user: UserEntity,
    familyId: string | null,
    context: AuthContext,
  ): Promise<AuthResult> {
    const [accessToken, refresh] = await Promise.all([
      this.tokens.signAccessToken(user),
      this.tokens.issueRefreshToken(user, familyId, context),
    ]);

    return {
      accessToken,
      refreshToken: refresh.token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
        permissions: this.usersService.permissionsFor(user),
      },
    };
  }
}
