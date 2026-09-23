import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @MinLength(1, { message: 'message cannot be empty' })
  @MaxLength(4000)
  content!: string;

  /**
   * Echoed back so the client can reconcile its optimistic bubble with the
   * stored row instead of rendering the message twice.
   */
  @IsOptional()
  @IsUUID()
  clientMessageId?: string;
}
