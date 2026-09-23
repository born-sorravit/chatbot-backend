import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Migration 002 — organizations, users, refresh tokens (docs/DATABASE.md §3.1). */
export class OrganizationsUsersAuth1758000002000 implements MigrationInterface {
  name = 'OrganizationsUsersAuth1758000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "organizations" (
        "id"         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        "name"       varchar(200) NOT NULL,
        "slug"       varchar(100) NOT NULL,
        "settings"   jsonb        NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz  NOT NULL DEFAULT now(),
        "updated_at" timestamptz  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_organizations_slug" ON "organizations" ("slug")`,
    );

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid         NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "email"           citext       NOT NULL,
        "password_hash"   varchar(255) NOT NULL,
        "name"            varchar(200) NOT NULL,
        "avatar_url"      text,
        "role"            "user_role"  NOT NULL DEFAULT 'AGENT',
        "permissions"     jsonb        NOT NULL DEFAULT '[]'::jsonb,
        "is_active"       boolean      NOT NULL DEFAULT true,
        "last_login_at"   timestamptz,
        "created_at"      timestamptz  NOT NULL DEFAULT now(),
        "updated_at"      timestamptz  NOT NULL DEFAULT now()
      )
    `);
    // citext handles case-insensitivity in the database, so the index is on
    // the plain column — no lower() wrapper (docs/DATABASE.md §3.1).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_users_org_email" ON "users" ("organization_id", "email")`,
    );
    await queryRunner.query(`CREATE INDEX "ix_users_org" ON "users" ("organization_id")`);

    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id"         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"    uuid         NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "token_hash" varchar(255) NOT NULL,
        "family_id"  uuid         NOT NULL,
        "expires_at" timestamptz  NOT NULL,
        "revoked_at" timestamptz,
        "user_agent" text,
        "ip"         inet,
        "created_at" timestamptz  NOT NULL DEFAULT now(),
        "updated_at" timestamptz  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_refresh_hash" ON "refresh_tokens" ("token_hash")`,
    );
    // Partial index — the active-session lookup only ever wants unrevoked rows.
    await queryRunner.query(
      `CREATE INDEX "ix_refresh_user_active" ON "refresh_tokens" ("user_id") WHERE "revoked_at" IS NULL`,
    );
    // Replay detection revokes by family, so that lookup needs its own index.
    await queryRunner.query(
      `CREATE INDEX "ix_refresh_family" ON "refresh_tokens" ("family_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "organizations"`);
  }
}
