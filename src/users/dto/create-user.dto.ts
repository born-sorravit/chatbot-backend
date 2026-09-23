import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '../../common/constants';

export class CreateUserDto {
  @IsEmail({}, { message: 'must be a valid email address' })
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'must be at least 8 characters' })
  @MaxLength(256)
  password!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  /**
   * Extra grants beyond the role. Unknown strings are dropped by
   * resolvePermissions, so a bad value here cannot invent a capability.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}
