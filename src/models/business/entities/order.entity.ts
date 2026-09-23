import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantEntity } from '@/models/base.entity';
import { OrderStatus } from '@/shared/constants';
import type { CustomerEntity } from '@/models/customers/entities/customer.entity';

/** Placeholder pending OQ-04 — see product.entity.ts. */
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

  @Column({
    type: 'enum',
    enum: OrderStatus,
    enumName: 'order_status',
    default: OrderStatus.Pending,
  })
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
