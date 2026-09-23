import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { z } from 'zod';
import { OrderEntity } from '../../database/entities';
import { TOOL_NAMES } from '../../common/constants';
import type { AITool, ToolContext } from '../tool.interface';

const inputSchema = z.object({
  orderId: z
    .string()
    .min(1)
    .max(64)
    .describe('The order number the customer gave, without any leading #'),
});

type Input = z.infer<typeof inputSchema>;

@Injectable()
export class GetOrderStatusTool implements AITool<Input> {
  readonly name = TOOL_NAMES.GetOrderStatus;
  readonly description =
    'Look up the status and tracking number of an order by its order number. ' +
    'Never guess or infer an order status — always call this.';
  readonly inputSchema = inputSchema;
  readonly mutating = false;

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
  ) {}

  async execute(input: Input, context: ToolContext) {
    // Customers type "#1234"; the stored number has no hash.
    const orderNumber = input.orderId.replace(/^#/, '').trim();

    const order = await this.orders.findOne({
      where: { organizationId: context.organizationId, orderNumber },
    });

    if (!order) {
      return { found: false };
    }

    /**
     * Scoped to the customer in this conversation.
     *
     * Order numbers are guessable, and without this check a customer could
     * read someone else's order simply by asking the AI about it — a
     * tenant-internal leak that organization scoping alone does not prevent.
     */
    if (order.customerId && order.customerId !== context.customerId) {
      return { found: false, reason: 'not_owned_by_this_customer' };
    }

    return {
      found: true,
      orderNumber: order.orderNumber,
      status: order.status,
      total: Number(order.totalCents) / 100,
      currency: order.currency,
      trackingNumber: order.trackingNumber,
      shippedAt: order.shippedAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
    };
  }
}
