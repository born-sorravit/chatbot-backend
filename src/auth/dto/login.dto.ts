import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'must be a valid email address' })
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'must be at least 8 characters' })
  @MaxLength(256)
  password!: string;

  /**
   * Optional tenant hint. Without it, login resolves the user by email alone,
   * which is fine while emails are unique per organization and the MVP has
   * one organization. Multi-tenant deployments where the same address exists
   * in two organizations must send it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  organizationSlug?: string;
}
