import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '@/models/base.entity';
import type { UserEntity } from '@/models/users/entities/user.entity';
import type { CustomerEntity } from '@/models/customers/entities/customer.entity';

@Entity({ name: 'organizations' })
export class OrganizationEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  slug!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  settings!: Record<string, unknown>;

  @OneToMany('UserEntity', (user: UserEntity) => user.organization)
  users?: UserEntity[];

  @OneToMany('CustomerEntity', (customer: CustomerEntity) => customer.organization)
  customers?: CustomerEntity[];
}
