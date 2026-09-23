import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 001 — extensions and enum types (docs/DATABASE.md §5).
 *
 * All enums are created up front even though most of their tables arrive in
 * later phases. Enum creation is cheap and order-independent, and keeping the
 * catalogue in one reviewable place beats scattering CREATE TYPE across eight
 * migrations.
 *
 * Hand-written on purpose: `migration:generate` cannot express extensions,
 * enums it has no entity for, partial-index predicates, or the pgvector HNSW
 * index that Phase 4 needs.
 */
export class ExtensionsAndEnums1758000001000 implements MigrationInterface {
  name = 'ExtensionsAndEnums1758000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // gen_random_uuid() lives in pgcrypto on PG < 13 and core on >= 13;
    // creating it is harmless and keeps older targets working.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "citext"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "vector"`);

    await queryRunner.query(`CREATE TYPE "user_role" AS ENUM ('OWNER', 'ADMIN', 'AGENT')`);
    await queryRunner.query(
      `CREATE TYPE "conversation_status" AS ENUM ('OPEN', 'PENDING', 'CLOSED')`,
    );
    await queryRunner.query(`CREATE TYPE "conversation_mode" AS ENUM ('AI', 'HUMAN')`);
    await queryRunner.query(
      `CREATE TYPE "message_sender_type" AS ENUM ('CUSTOMER', 'AI', 'ADMIN', 'SYSTEM')`,
    );
    await queryRunner.query(
      `CREATE TYPE "message_type" AS ENUM ('TEXT', 'IMAGE', 'FILE', 'SYSTEM')`,
    );
    await queryRunner.query(
      `CREATE TYPE "document_status" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "document_source" AS ENUM ('TEXT', 'MARKDOWN', 'FAQ', 'PDF', 'URL')`,
    );
    await queryRunner.query(
      `CREATE TYPE "tool_exec_status" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'RUNNING', 'SUCCESS', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "notification_type" AS ENUM ('NEW_CONVERSATION', 'CUSTOMER_REQUESTED_HUMAN', 'AI_HANDOFF', 'NEW_MESSAGE', 'TOOL_APPROVAL_REQUIRED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "handoff_reason" AS ENUM ('CUSTOMER_REQUESTED', 'AI_CANNOT_ANSWER', 'NO_KNOWLEDGE_FOUND', 'TOOL_ERROR', 'PROVIDER_ERROR', 'SENSITIVE_TOPIC', 'BUSINESS_RULE', 'MANUAL_TAKEOVER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "order_status" AS ENUM ('PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const enumName of [
      'order_status',
      'handoff_reason',
      'notification_type',
      'tool_exec_status',
      'document_source',
      'document_status',
      'message_type',
      'message_sender_type',
      'conversation_mode',
      'conversation_status',
      'user_role',
    ]) {
      await queryRunner.query(`DROP TYPE IF EXISTS "${enumName}"`);
    }
    // Extensions are intentionally not dropped — other schemas in the same
    // database may depend on them.
  }
}
