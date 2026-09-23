import { IsOptional, IsUUID } from 'class-validator';

export class AssignDto {
  /** Omit or send null to unassign. */
  @IsOptional()
  @IsUUID()
  userId?: string | null;
}
