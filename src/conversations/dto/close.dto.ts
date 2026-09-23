import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CloseDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolution?: string;
}
