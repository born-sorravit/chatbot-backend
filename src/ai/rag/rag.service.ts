import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiAgentKnowledgeBaseEntity } from '../../database/entities';
import { EmbeddingsRepository, type RetrievedChunk } from '../../embeddings/embeddings.repository';
import { AppConfig } from '../../config';
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from '../providers/embedding.provider';

export interface RagResult {
  chunks: RetrievedChunk[];
  /** True when the agent has knowledge bases linked but nothing cleared the bar. */
  searched: boolean;
  maxDistanceUsed: number;
}

/**
 * Retrieval for the AI orchestrator (master plan §22, §23).
 */
@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly embeddings: EmbeddingsRepository,
    private readonly config: AppConfig,
    @Inject(EMBEDDING_PROVIDER) private readonly provider: EmbeddingProvider,
    @InjectRepository(AiAgentKnowledgeBaseEntity)
    private readonly agentKnowledgeBases: Repository<AiAgentKnowledgeBaseEntity>,
  ) {}

  /**
   * The distance bar.
   *
   * Falls back to the provider's own measured default, because the right
   * threshold is a property of the embedding model rather than of this
   * application — hashed n-grams and a trained encoder spread distances
   * differently by a wide margin.
   */
  get maxDistance(): number {
    return this.config.ragMaxDistance ?? this.provider.defaultMaxDistance;
  }

  async knowledgeBaseIdsForAgent(
    organizationId: string,
    aiAgentId: string,
  ): Promise<string[]> {
    const links = await this.agentKnowledgeBases.find({
      where: { organizationId, aiAgentId },
    });
    return links.map((link) => link.knowledgeBaseId);
  }

  /**
   * Retrieves the chunks relevant to a question.
   *
   * Fetches `candidateK` and narrows to `topK` after thresholding, because
   * the tenant filter is applied *after* the ANN scan and can therefore thin
   * the result set unpredictably.
   *
   * Returning nothing is a valid, intended outcome: without the distance bar,
   * vector search always returns its nearest row however irrelevant, and the
   * model will dutifully answer from it. That is precisely the hallucination
   * §23 exists to prevent.
   */
  async retrieve(
    organizationId: string,
    knowledgeBaseIds: string[],
    question: string,
  ): Promise<RagResult> {
    const maxDistance = this.maxDistance;

    if (knowledgeBaseIds.length === 0) {
      return { chunks: [], searched: false, maxDistanceUsed: maxDistance };
    }

    const queryVector = await this.provider.embedOne(question, 'query');

    const candidates = await this.embeddings.search(
      organizationId,
      knowledgeBaseIds,
      queryVector,
      this.config.ragCandidateK,
    );

    const relevant = candidates
      .filter((chunk) => chunk.distance <= maxDistance)
      .slice(0, this.config.ragTopK);

    this.logger.log({
      event: 'rag.retrieve',
      organizationId,
      candidates: candidates.length,
      relevant: relevant.length,
      nearest: candidates[0]?.distance ?? null,
      maxDistance,
    });

    return { chunks: relevant, searched: true, maxDistanceUsed: maxDistance };
  }

  /** Debug search for the admin UI — no thresholding, so distances are visible. */
  async debugSearch(
    organizationId: string,
    knowledgeBaseIds: string[],
    question: string,
    limit: number,
  ): Promise<{ chunks: RetrievedChunk[]; maxDistance: number }> {
    const queryVector = await this.provider.embedOne(question, 'query');
    const chunks = await this.embeddings.search(
      organizationId,
      knowledgeBaseIds,
      queryVector,
      limit,
    );
    return { chunks, maxDistance: this.maxDistance };
  }
}
