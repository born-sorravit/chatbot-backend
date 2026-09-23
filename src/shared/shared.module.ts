import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';

@Global()
@Module({
  imports: [DatabaseModule, RedisModule],
  exports: [DatabaseModule, RedisModule],
})
export class SharedModule {}
