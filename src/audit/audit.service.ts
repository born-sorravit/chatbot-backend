import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from '../database/entities';

export interface AuditRecord {
  organizationId: string;
  actorType: 'USER' | 'SYSTEM' | 'AI';
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  changes?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/** Security audit log (master plan §42). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly logs: Repository<AuditLogEntity>,
  ) {}

  /**
   * Never throws.
   *
   * An audit write failing must not roll back the action it describes — a
   * takeover that succeeded should stay succeeded. The failure is logged
   * loudly instead, because a silently missing audit trail is worse than a
   * noisy one.
   */
  async record(record: AuditRecord): Promise<void> {
    try {
      await this.logs.save(
        this.logs.create({
          organizationId: record.organizationId,
          actorType: record.actorType,
          actorId: record.actorId ?? null,
          action: record.action,
          resourceType: record.resourceType,
          resourceId: record.resourceId ?? null,
          changes: record.changes ?? {},
          ip: record.ip ?? null,
          userAgent: record.userAgent ?? null,
        }),
      );
    } catch (error) {
      this.logger.error({
        event: 'audit.write_failed',
        action: record.action,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async list(organizationId: string, limit: number) {
    return this.logs.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
