import { Column, Entity, Index } from 'typeorm';
import { TenantEntity } from '@/models/base.entity';

/**
 * Minimal business data backing the MVP tools (docs/ARCHITECTURE.md TD-08).
 *
 * §24 names getProduct / getProductStock / getOrderStatus, but §7's domain
 * model has no product or order entity. These two tables, seeded with
 * fixtures, let the tool-calling architecture be real and demonstrable
 * without inventing an ERP integration.
 *
 * **Placeholder pending OQ-04.** Swapping to a real system means replacing
 * three `execute()` bodies — the tables and this file (plus order.entity.ts) go away entirely.
 */
@Entity({ name: 'products' })
@Index('ux_product_org_sku', ['organizationId', 'sku'], { unique: true })
export class ProductEntity extends TenantEntity {
  @Column({ type: 'varchar', length: 64 })
  sku!: string;

  @Column({ type: 'varchar', length: 300 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /**
   * Integer minor units. Floating-point currency is a bug that surfaces in a
   * customer-facing message.
   */
  @Column({ name: 'price_cents', type: 'bigint' })
  priceCents!: string;

  @Column({ type: 'varchar', length: 3, default: 'THB' })
  currency!: string;

  @Column({ name: 'stock_quantity', type: 'int', default: 0 })
  stockQuantity!: number;

  /** Colour, size and so on — what a stock question actually filters by. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  attributes!: Record<string, unknown>;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;
}
