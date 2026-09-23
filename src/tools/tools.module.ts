import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AiAgentToolEntity,
  AiToolEntity,
  OrderEntity,
  ProductEntity,
  ToolExecutionEntity,
} from '../database/entities';
import { ToolService } from './tool.service';
import { ToolsAdminService } from './tools-admin.service';
import { ToolExecutionsController, ToolsController } from './tools.controller';
import { GetOrderStatusTool } from './registry/get-order-status.tool';
import { GetProductStockTool } from './registry/get-product-stock.tool';
import { GetProductTool } from './registry/get-product.tool';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiToolEntity,
      AiAgentToolEntity,
      ToolExecutionEntity,
      ProductEntity,
      OrderEntity,
    ]),
  ],
  controllers: [ToolsController, ToolExecutionsController],
  providers: [
    GetProductTool,
    GetProductStockTool,
    GetOrderStatusTool,
    ToolService,
    ToolsAdminService,
  ],
  exports: [ToolService, ToolsAdminService],
})
export class ToolsModule {}
