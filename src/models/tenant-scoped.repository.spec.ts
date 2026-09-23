import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { TenantScopedRepository, type TenantScoped } from './tenant-scoped.repository';

interface Widget extends TenantScoped {
  name: string;
}

class WidgetRepository extends TenantScopedRepository<Widget> {
  constructor(repository: Repository<Widget>) {
    super(repository, 'Widget');
  }
}

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

function mockRepository() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    count: jest.fn(),
    create: jest.fn((input: unknown) => input),
    save: jest.fn((input: unknown) => input),
    remove: jest.fn(),
  } as unknown as jest.Mocked<Repository<Widget>>;
}

describe('TenantScopedRepository', () => {
  let repository: jest.Mocked<Repository<Widget>>;
  let widgets: WidgetRepository;

  beforeEach(() => {
    repository = mockRepository();
    widgets = new WidgetRepository(repository);
  });

  it('puts organizationId into every findById query', async () => {
    repository.findOne.mockResolvedValue(null);
    await widgets.findById(ORG_A, 'widget-1');

    expect(repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'widget-1', organizationId: ORG_A },
      }),
    );
  });

  it('throws 404 — not 403 — when the row belongs to another tenant', async () => {
    // A 403 would confirm the resource exists, which is itself a leak.
    repository.findOne.mockResolvedValue(null);

    await expect(widgets.findByIdOrFail(ORG_A, 'widget-in-org-b')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not let a caller-supplied where override the tenant scope', async () => {
    repository.find.mockResolvedValue([]);

    // The malicious filter tries to redirect the query at another tenant.
    await widgets.findMany(ORG_A, {
      where: { organizationId: ORG_B } as never,
    });

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG_A } }),
    );
  });

  it('forces organizationId onto created rows', async () => {
    await widgets.create(ORG_A, { name: 'w', organizationId: ORG_B } as never);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_A }),
    );
  });

  it('strips organizationId and id from update patches', async () => {
    const existing = { id: 'w1', organizationId: ORG_A, name: 'before' };
    repository.findOne.mockResolvedValue(existing as Widget);

    await widgets.updateById(ORG_A, 'w1', {
      name: 'after',
      organizationId: ORG_B,
      id: 'other-id',
    } as never);

    // A patch must never be able to move a row between tenants.
    expect(existing.organizationId).toBe(ORG_A);
    expect(existing.id).toBe('w1');
    expect(existing.name).toBe('after');
  });

  it('scopes count and exists', async () => {
    repository.count.mockResolvedValue(0);
    await widgets.exists(ORG_A, { name: 'x' } as never);

    expect(repository.count).toHaveBeenCalledWith({
      where: { name: 'x', organizationId: ORG_A },
    });
  });

  it('refuses to delete another tenant row', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(widgets.deleteById(ORG_A, 'widget-in-org-b')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.remove).not.toHaveBeenCalled();
  });
});
