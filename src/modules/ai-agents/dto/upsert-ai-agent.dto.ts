import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AI_EFFORT_LEVELS, AI_TONES, ALLOWED_LLM_MODELS } from '@/shared/constants';

export class CreateAiAgentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @MinLength(20, { message: 'system prompt must be at least 20 characters' })
  @MaxLength(20000)
  systemPrompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;

  @IsOptional()
  @IsIn(AI_TONES)
  tone?: string;

  /**
   * Validated against an allowlist, not free text: a typo here would take
   * the AI offline for every customer of this organization.
   */
  @IsOptional()
  @IsIn(ALLOWED_LLM_MODELS)
  model?: string;

  @IsOptional()
  @IsIn(AI_EFFORT_LEVELS)
  effort?: string;

  @IsOptional()
  @IsInt()
  @Min(256)
  @Max(8192)
  maxTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxContextMessages?: number;

  @IsOptional()
  @IsBoolean()
  autoReply?: boolean;

  @IsOptional()
  @IsBoolean()
  handoffEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  ragEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * Replace-semantics: the array sent becomes the complete set of linked
   * knowledge bases. Partial updates to a permission-like list are how a
   * link stays active after someone thought they removed it.
   */
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  knowledgeBaseIds?: string[];

  /**
   * The tool allowlist (§25). Replace-semantics, like knowledgeBaseIds — a
   * partial update to a permission list is how a tool stays enabled after
   * someone thought they had removed it.
   */
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  toolIds?: string[];
}

export class UpdateAiAgentDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MinLength(20) @MaxLength(20000) systemPrompt?: string;
  @IsOptional() @IsString() @MaxLength(10) language?: string;
  @IsOptional() @IsIn(AI_TONES) tone?: string;
  @IsOptional() @IsIn(ALLOWED_LLM_MODELS) model?: string;
  @IsOptional() @IsIn(AI_EFFORT_LEVELS) effort?: string;
  @IsOptional() @IsInt() @Min(256) @Max(8192) maxTokens?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) maxContextMessages?: number;
  @IsOptional() @IsBoolean() autoReply?: boolean;
  @IsOptional() @IsBoolean() handoffEnabled?: boolean;
  @IsOptional() @IsBoolean() ragEnabled?: boolean;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) knowledgeBaseIds?: string[];
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) toolIds?: string[];
}

export class TestAiAgentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;
}
