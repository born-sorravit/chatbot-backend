import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { z } from 'zod';
import { ProductEntity } from '../../database/entities';
import { TOOL_NAMES } from '../../common/constants';
import type { AITool, ToolContext } from '../tool.interface';

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(200)
    .describe('Product name or SKU to look up, as the customer said it'),
});

type Input = z.infer<typeof inputSchema>;

@Injectable()
export class GetProductTool implements AITool<Input> {
  readonly name = TOOL_NAMES.GetProduct;
  readonly description =
    'Look up a product by name or SKU. Returns its price, currency and attributes. ' +
    'Use this whenever a customer asks about a specific product — never state a price from memory.';
  readonly inputSchema = inputSchema;
  readonly mutating = false;

  constructor(
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
  ) {}

  async execute(input: Input, context: ToolContext) {
    const products = await this.products.find({
      where: [
        // organizationId is from the context, never the model input.
        { organizationId: context.organizationId, name: ILike(`%${input.query}%`), isActive: true },
        { organizationId: context.organizationId, sku: ILike(`%${input.query}%`), isActive: true },
      ],
      take: 5,
    });

    if (products.length === 0) {
      // A structured "not found" rather than an error: the model should tell
      // the customer it could not find the product, not apologise for a crash.
      return { found: false, products: [] };
    }

    return {
      found: true,
      products: products.map((product) => ({
        sku: product.sku,
        name: product.name,
        description: product.description,
        // Minor units converted once, here — never in a prompt.
        price: Number(product.priceCents) / 100,
        currency: product.currency,
        attributes: product.attributes,
      })),
    };
  }
}
