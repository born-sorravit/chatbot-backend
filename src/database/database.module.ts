import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig, AppConfigModule } from '../config';
import { buildDataSourceOptions } from './data-source';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        ...buildDataSourceOptions(),
        url: config.databaseUrl,
        logging: config.databaseLogging,
      }),
    }),
  ],
})
export class DatabaseModule {}
