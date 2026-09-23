import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { IsNull, LessThan, Repository } from 'typeorm';
import { RefreshTokenEntity, type UserEntity } from '@/models/entities';
import { ConfigService } from '@nestjs/config';

export interface AccessTokenPayload {
  /** Subject — user id. */
  sub: string;
  /** Tenant. Read from the signed token, never from client input. */
  org: string;
  email: string;
  role: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface RefreshContext {
  userAgent?: string | null;
  ip?: string | null;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokens: Repository<RefreshTokenEntity>,
  ) {}

  /** Refresh tokens are opaque random strings, not JWTs — nothing reads them. */
  private generateOpaqueToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseDurationToMs(duration: string): number {
    const match = /^(\d+)([smhd])$/.exec(duration);

    if (!match) {
      throw new Error(`Invalid duration string: ${duration}`);
    }

    const value = Number(match[1]);
    const unitMs: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };

    return value * unitMs[match[2]];
  }

  async signAccessToken(user: UserEntity): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      org: user.organizationId,
      email: user.email,
      role: user.role,
    };

    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('security.jwt.secret'),
      // Passed as seconds rather than the raw duration string: @nestjs/jwt
      // types expiresIn against ms's StringValue template type, and our
      // already-validated duration is a plain string.
      expiresIn: Math.floor(
        this.parseDurationToMs(this.config.getOrThrow<string>('security.jwt.accessTtl')) / 1000,
      ),
    });
  }

  /**
   * Issues a refresh token into a family.
   *
   * A login starts a new family; a rotation continues the existing one, so a
   * replayed token can be traced to every descendant it spawned.
   */
  async issueRefreshToken(
    user: UserEntity,
    familyId: string | null,
    context: RefreshContext = {},
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = this.generateOpaqueToken();
    const expiresAt = new Date(
      Date.now() +
        this.parseDurationToMs(this.config.getOrThrow<string>('security.jwt.refreshTtl')),
    );

    await this.refreshTokens.save(
      this.refreshTokens.create({
        userId: user.id,
        tokenHash: this.hash(token),
        familyId: familyId ?? randomUUID(),
        expiresAt,
        userAgent: context.userAgent ?? null,
        ip: context.ip ?? null,
      }),
    );

    return { token, expiresAt };
  }

  async findValidRefreshToken(token: string): Promise<RefreshTokenEntity | null> {
    return this.refreshTokens.findOne({ where: { tokenHash: this.hash(token) } });
  }

  async revokeToken(id: string): Promise<void> {
    await this.refreshTokens.update({ id, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  /**
   * Revokes every live token descended from one login.
   *
   * Triggered when an already-revoked token is presented: that means the
   * token was captured and replayed, so the whole family is burned rather
   * than just the replayed member.
   */
  async revokeFamily(familyId: string): Promise<void> {
    await this.refreshTokens.update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokens.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  /** Housekeeping for expired rows. Called by a scheduled job in a later phase. */
  async purgeExpired(): Promise<number> {
    const result = await this.refreshTokens.delete({ expiresAt: LessThan(new Date()) });
    return result.affected ?? 0;
  }
}
