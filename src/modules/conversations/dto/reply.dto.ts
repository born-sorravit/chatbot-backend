import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ReplyDto {
  @IsString()
  @MinLength(1, { message: 'message cannot be empty' })
  @MaxLength(4000)
  content!: string;

  @IsOptional()
  @IsUUID()
  clientMessageId?: string;
}
