import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDataSourceOptions } from './data-source';

@Module({
  imports: [TypeOrmModule.forRoot(buildDataSourceOptions())],
})
export class DatabaseModule {}
