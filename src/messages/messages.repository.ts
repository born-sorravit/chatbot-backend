import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageEntity } from '../database/entities';

export interface CursorPage {
  before?: string;
  limit: number;
}

@Injectable()
export class MessagesRepository {
  constructor(
    @InjectRepository(MessageEntity) private readonly repository: Repository<MessageEntity>,
  ) {}

  /**
   * Cursor-paginated transcript (docs/API.md §0).
   *
   * Cursor rather than offset because a live, append-heavy transcript shifts
   * under an offset — rows get skipped or repeated as new messages arrive.
   *
   * Ordered by `(created_at, id)` in both directions: two messages can share a
   * millisecond, and a transcript that reorders on refetch looks broken.
   */
  async listByConversation(
    organizationId: string,
    conversationId: string,
    page: CursorPage,
  ): Promise<{ messages: MessageEntity[]; hasMore: boolean; nextCursor: string | null }> {
    const query = this.repository
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.attachments', 'attachment')
      .where('message.organization_id = :organizationId', { organizationId })
      .andWhere('message.conversation_id = :conversationId', { conversationId });

    if (page.before) {
      const cursor = await this.repository.findOne({
        where: { id: page.before, organizationId },
        select: { id: true, createdAt: true },
      });

      if (cursor) {
        query.andWhere(
          '(message.created_at, message.id) < (:cursorCreatedAt, :cursorId)',
          { cursorCreatedAt: cursor.createdAt, cursorId: cursor.id },
        );
      }
    }

    // Fetch newest-first with one extra row to detect a further page...
    const rows = await query
      .orderBy('message.created_at', 'DESC')
      .addOrderBy('message.id', 'DESC')
      .take(page.limit + 1)
      .getMany();

    const hasMore = rows.length > page.limit;
    const pageRows = hasMore ? rows.slice(0, page.limit) : rows;

    return {
      // ...then reverse, so the caller renders oldest-to-newest.
      messages: [...pageRows].reverse(),
      hasMore,
      nextCursor: hasMore ? (pageRows.at(-1)?.id ?? null) : null,
    };
  }

  async findById(organizationId: string, id: string): Promise<MessageEntity | null> {
    return this.repository.findOne({
      where: { id, organizationId },
      relations: { attachments: true },
    });
  }
}
