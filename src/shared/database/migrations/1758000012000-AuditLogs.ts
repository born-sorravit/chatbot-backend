import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Migration 012 — security audit log (master plan §42). */
export class AuditLogs1758000012000 implements MigrationInterface {
  name = 'AuditLogs1758000012000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "actor_type"      varchar(16) NOT NULL,
        -- Not an FK: the actor may be SYSTEM or AI, and a deleted user's
        -- actions must remain attributable.
        "actor_id"        uuid,
        "action"          varchar(100) NOT NULL,
        "resource_type"   varchar(64)  NOT NULL,
        "resource_id"     uuid,
        "changes"         jsonb NOT NULL DEFAULT '{}'::jsonb,
        "ip"              inet,
        "user_agent"      text,
        "created_at"      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_audit_org_created" ON "audit_logs" ("organization_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_audit_resource" ON "audit_logs" ("resource_type", "resource_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
  }
}
