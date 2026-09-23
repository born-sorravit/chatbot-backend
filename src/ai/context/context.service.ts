import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationEntity, CustomerEntity, MessageEntity } from '../../database/entities';
import { MessageSenderType } from '../../common/constants';
import type { LLMMessage } from '../providers/llm.provider';

export interface ConversationContext {
  recentMessages: LLMMessage[];
  summary: string | null;
  customer: {
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
}

/**
 * Assembles what the model is allowed to see (master plan §18).
 *
 * Never the whole conversation: the window is capped by the agent's
 * `maxContextMessages`, because an uncapped history is both the main cost
 * driver and the main way a long conversation quietly stops fitting.
 */
@Injectable()
export class ContextService {
  constructor(
    @InjectRepository(MessageEntity)
    private readonly messages: Repository<MessageEntity>,
    @InjectRepository(CustomerEntity)
    private readonly customers: Repository<CustomerEntity>,
  ) {}

  async build(
    conversation: ConversationEntity,
    maxContextMessages: number,
  ): Promise<ConversationContext> {
    const rows = await this.messages.find({
      where: {
        organizationId: conversation.organizationId,
        conversationId: conversation.id,
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: maxContextMessages,
    });

    const customer = await this.customers.findOne({
      where: { id: conversation.customerId, organizationId: conversation.organizationId },
    });

    return {
      // Fetched newest-first for the LIMIT, then reversed: the model needs
      // chronological order.
      recentMessages: [...rows].reverse().flatMap((message) => this.toLlmMessage(message)),
      summary: conversation.summary,
      customer: customer
        ? { name: customer.name, email: customer.email, phone: customer.phone }
        : null,
    };
  }

  /**
   * Maps a stored message onto a chat turn.
   *
   * SYSTEM messages are dropped: they are UI bookkeeping ("conversation
   * closed"), and feeding them back as conversation would teach the model to
   * imitate them.
   */
  private toLlmMessage(message: MessageEntity): LLMMessage[] {
    if (!message.content) {
      return [];
    }

    switch (message.senderType) {
      case MessageSenderType.Customer:
        return [{ role: 'user', content: message.content }];
      case MessageSenderType.Ai:
      case MessageSenderType.Admin:
        // An admin reply is presented as the assistant's own prior turn: from
        // the customer's side of the conversation it is indistinguishable,
        // and splitting the two would make the transcript incoherent after a
        // takeover and return-to-AI.
        return [{ role: 'assistant', content: message.content }];
      default:
        return [];
    }
  }
}
