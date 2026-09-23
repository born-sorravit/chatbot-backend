import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { z } from 'zod';
import { ProductEntity } from '../../database/entities';
import { TOOL_NAMES } from '../../common/constants';
import type { AITool, ToolContext } from '../tool.interface';

const inputSchema = z.object({
  query: z.string().min(1).max(200).describe('Product name or SKU'),
  variant: z
    .string()
    .max(100)
    .optional()
    .describe('Optional variant such as a colour or size, if the customer named one'),
});

type Input = z.infer<typeof inputSchema>;

@Injectable()
export class GetProductStockTool implements AITool<Input> {
  readonly name = TOOL_NAMES.GetProductStock;
  readonly description =
    'Check live stock for a product, optionally for a specific variant (colour, size). ' +
    'Always use this before telling a customer whether something is in stock.';
  readonly inputSchema = inputSchema;
  readonly mutating = false;

  constructor(
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
  ) {}

  async execute(input: Input, context: ToolContext) {
    const products = await this.products.find({
      where: [
        { organizationId: context.organizationId, name: ILike(`%${input.query}%`), isActive: true },
        { organizationId: context.organizationId, sku: ILike(`%${input.query}%`), isActive: true },
      ],
      take: 10,
    });

    const matching = input.variant
      ? products.filter((product) =>
          Object.values(product.attributes).some(
            (value) =>
              typeof value === 'string' &&
              value.toLowerCase().includes(input.variant!.toLowerCase()),
          ),
        )
      : products;

    if (matching.length === 0) {
      return { found: false, items: [] };
    }

    return {
      found: true,
      items: matching.map((product) => ({
        sku: product.sku,
        name: product.name,
        attributes: product.attributes,
        stockQuantity: product.stockQuantity,
        // Stated explicitly so the model does not have to infer availability
        // from a number and get it wrong at the boundary.
        inStock: product.stockQuantity > 0,
      })),
    };
  }
}
