import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

export class AnalyticsRangeDto {
  /** Inclusive start, ISO 8601. Defaults to `days` ago. */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Exclusive end, ISO 8601. Defaults to now. */
  @IsOptional()
  @IsISO8601()
  to?: string;

  /** Convenience window when `from`/`to` are omitted. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days: number = 30;
}
