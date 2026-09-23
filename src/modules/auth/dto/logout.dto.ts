import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Logout body.
 *
 * A real class, not `Partial<RefreshDto>` — a mapped type erases to `Object`
 * in `design:type` metadata, so ValidationPipe would have nothing to validate
 * against and would pass the body through untouched. A non-string
 * `refreshToken` then reached `createHash().update()` and produced a 500
 * where a 400 belongs.
 */
export class LogoutDto {
  @IsOptional()
  @IsString()
  @MinLength(32)
  @MaxLength(512)
  refreshToken?: string;
}
