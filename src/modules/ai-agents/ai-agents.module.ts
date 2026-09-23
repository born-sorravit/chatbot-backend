import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiAgentEntity } from '@/models/entities';
import { AiModule } from '@/modules/ai/ai.module';
import { AiAgentsController } from './ai-agents.controller';
import { AiAgentsService } from './ai-agents.service';
import { AiAgentTester } from './ai-agent-tester.service';

@Module({
  imports: [TypeOrmModule.forFeature([AiAgentEntity]), AiModule],
  controllers: [AiAgentsController],
  providers: [AiAgentsService, AiAgentTester],
  exports: [AiAgentsService],
})
export class AiAgentsModule {}
