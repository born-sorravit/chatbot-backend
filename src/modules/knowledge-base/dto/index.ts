import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { DocumentSource, DocumentStatus } from '@/shared/constants';

export class UpsertKnowledgeBaseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class CreateDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @IsEnum(DocumentSource)
  sourceType!: DocumentSource;

  /** Required for every source except URL, where the page supplies it. */
  @ValidateIf((dto: CreateDocumentDto) => dto.sourceType !== DocumentSource.Url)
  @IsString()
  @MinLength(1, { message: 'content is required for this source type' })
  @MaxLength(500_000)
  content?: string;

  @ValidateIf((dto: CreateDocumentDto) => dto.sourceType === DocumentSource.Url)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  sourceUrl?: string;
}

export class ListDocumentsDto {
  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;
}

export class SearchKnowledgeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = 5;
}
