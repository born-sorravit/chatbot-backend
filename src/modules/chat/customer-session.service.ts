import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { CustomerSessionEntity } from '@/models/entities';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedCustomer } from '@/shared/interfaces';

export interface SessionContext {
  userAgent?: string | null;
  ip?: string | null;
}

/**
 * Anonymous customer sessions (docs/ARCHITECTURE.md TD-09).
 *
 * Tokens are opaque random strings stored as sha256 hashes — the same
 * treatment refresh tokens get, for the same reason: a database leak must not
 * hand over live sessions.
 */
@Injectable()
export class CustomerSessionService {
  constructor(
    @InjectRepository(CustomerSessionEntity)
    private readonly sessions: Repository<CustomerSessionEntity>,
    private readonly config: ConfigService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private ttlMs(): number {
    const ttl = this.config.getOrThrow<string>('security.customerSessionTtl');
    const match = /^(\d+)([smhd])$/.exec(ttl);

    if (!match) {
      throw new Error(`Invalid CUSTOMER_SESSION_TTL: ${ttl}`);
    }

    const unitMs: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return Number(match[1]) * unitMs[match[2]];
  }

  async issue(
    organizationId: string,
    customerId: string,
    context: SessionContext = {},
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs());

    await this.sessions.save(
      this.sessions.create({
        organizationId,
        customerId,
        tokenHash: this.hash(token),
        expiresAt,
        lastSeenAt: new Date(),
        userAgent: context.userAgent ?? null,
        ip: context.ip ?? null,
      }),
    );

    return { token, expiresAt };
  }

  /**
   * Resolves a raw token to a principal, or throws 401.
   *
   * Returns the organization and customer from the stored row — never from
   * anything the client sent — so a customer token cannot be pointed at
   * another tenant.
   */
  async resolve(token: string | undefined): Promise<AuthenticatedCustomer> {
    if (!token) {
      throw new UnauthorizedException({
        code: 'INVALID_SESSION',
        message: 'Missing customer session',
      });
    }

    const session = await this.sessions.findOne({
      where: { tokenHash: this.hash(token), revokedAt: IsNull() },
    });

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({
        code: 'INVALID_SESSION',
        message: 'Customer session is invalid or has expired',
      });
    }

    return {
      customerId: session.customerId,
      organizationId: session.organizationId,
      sessionId: session.id,
    };
  }

  /** Best-effort liveness marker; never blocks the request path. */
  async touch(sessionId: string): Promise<void> {
    await this.sessions.update({ id: sessionId }, { lastSeenAt: new Date() });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.sessions.update({ id: sessionId }, { revokedAt: new Date() });
  }
}
