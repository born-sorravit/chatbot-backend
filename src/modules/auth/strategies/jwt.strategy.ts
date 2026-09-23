import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersRepository } from '@/models/users/users.repository';
import { UsersService } from '@/modules/users/users.service';
import type { AccessTokenPayload } from '@/modules/auth/token.service';
import type { AuthenticatedUser } from '@/shared/interfaces';
import type { UserRole } from '@/shared/constants';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly users: UsersRepository,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('security.jwt.secret'),
    });
  }

  /**
   * Runs after signature and expiry verification.
   *
   * The user is re-read from the database on every request rather than being
   * reconstructed from the token claims. That costs a query, but it means
   * deactivating a user or changing their permissions takes effect
   * immediately instead of when their access token happens to expire.
   *
   * `organizationId` comes from the reloaded row — the signed `org` claim is
   * only a hint, and the database is authoritative.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.users.findActiveById(payload.sub);

    if (!user) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'User no longer active',
      });
    }

    return {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
      permissions: this.usersService.permissionsFor(user),
    };
  }
}
