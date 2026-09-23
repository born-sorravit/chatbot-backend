import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiAgentEntity } from '../database/entities';
import { AiModule } from '../ai/ai.module';
import { AiAgentsController } from './ai-agents.controller';
import { AiAgentsRepository, AiAgentsService } from './ai-agents.service';
import { AiAgentTester } from './ai-agent-tester.service';

@Module({
  imports: [TypeOrmModule.forFeature([AiAgentEntity]), AiModule],
  controllers: [AiAgentsController],
  providers: [AiAgentsRepository, AiAgentsService, AiAgentTester],
  exports: [AiAgentsService],
})
export class AiAgentsModule {}
