import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ChannelType } from '@/shared/constants';

/** The three external channels. `web` is not connectable — it is built in. */
const EXTERNAL = [ChannelType.Line, ChannelType.Facebook, ChannelType.Whatsapp];

export class CreateChannelIntegrationDto {
  @IsEnum(ChannelType)
  @Type(() => String)
  channel!: ChannelType;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalAccountId?: string;

  /**
   * Provider secrets. Validated against the adapter's `requiredCredentials`
   * in the service rather than here — the required set depends on `channel`,
   * which a per-field decorator cannot express.
   */
  @IsObject()
  credentials!: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateChannelIntegrationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalAccountId?: string;

  /** Partial: only the keys present are replaced, so rotating one secret
   * does not require re-entering the others. */
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export { EXTERNAL as EXTERNAL_CHANNEL_VALUES };
