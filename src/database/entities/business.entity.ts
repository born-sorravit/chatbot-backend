import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantEntity } from './base.entity';
import { OrderStatus } from '../../common/constants';
import type { CustomerEntity } from './customer.entity';

/**
 * Minimal business data backing the MVP tools (docs/ARCHITECTURE.md TD-08).
 *
 * §24 names getProduct / getProductStock / getOrderStatus, but §7's domain
 * model has no product or order entity. These two tables, seeded with
 * fixtures, let the tool-calling architecture be real and demonstrable
 * without inventing an ERP integration.
 *
 * **Placeholder pending OQ-04.** Swapping to a real system means replacing
 * three `execute()` bodies — the tables and this file go away entirely.
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

@Entity({ name: 'orders' })
@Index('ux_order_org_number', ['organizationId', 'orderNumber'], { unique: true })
export class OrderEntity extends TenantEntity {
  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId!: string | null;

  /**
   * What a customer types ("Order #1234") — distinct from the uuid primary
   * key, and unique per organization.
   */
  @Column({ name: 'order_number', type: 'varchar', length: 64 })
  orderNumber!: string;

  @Column({ type: 'enum', enum: OrderStatus, enumName: 'order_status', default: OrderStatus.Pending })
  status!: OrderStatus;

  @Column({ name: 'total_cents', type: 'bigint' })
  totalCents!: string;

  @Column({ type: 'varchar', length: 3, default: 'THB' })
  currency!: string;

  @Column({ name: 'tracking_number', type: 'varchar', length: 100, nullable: true })
  trackingNumber!: string | null;

  @Column({ name: 'shipped_at', type: 'timestamptz', nullable: true })
  shippedAt!: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @ManyToOne('CustomerEntity', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer?: CustomerEntity | null;
}
