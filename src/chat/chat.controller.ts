import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ChatService } from './chat.service';
import { CreateSessionDto, ListMessagesDto, SendMessageDto, TypingDto } from './dto';
import { CurrentCustomer, Public } from '../common/decorators';
import {
  CUSTOMER_SESSION_COOKIE,
  CustomerSessionGuard,
  extractCustomerToken,
} from '../common/guards';
import type { AuthenticatedCustomer } from '../common/types';
import { AppConfig } from '../config';

/**
 * Customer-facing chat surface (docs/API.md §2).
 *
 * Every route is @Public() so the global JWT guard steps aside, then guarded
 * by CustomerSessionGuard instead — a different audience with a different
 * credential.
 */
@Public()
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly config: AppConfig,
  ) {}

  private contextFrom(request: Request) {
    return {
      userAgent: request.headers['user-agent'] ?? null,
      ip: request.ip ?? null,
    };
  }

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  async createSession(
    @Body() dto: CreateSessionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.chat.startSession(
      dto.organizationSlug,
      { name: dto.name, email: dto.email },
      extractCustomerToken(request),
      this.contextFrom(request),
    );

    // httpOnly so the widget's own JS cannot read it — the token is only ever
    // replayed by the browser. sameSite=lax is fine for a first-party widget;
    // an embed on a third-party origin will need sameSite=none + Secure,
    // which is why the bearer fallback exists.
    response.cookie(CUSTOMER_SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.isProduction,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    return result;
  }

  @UseGuards(CustomerSessionGuard)
  @Get('conversation')
  async conversation(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.chat.getConversation(customer.organizationId, customer.customerId);
  }

  @UseGuards(CustomerSessionGuard)
  @Get('messages')
  async messages(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Query() query: ListMessagesDto,
  ) {
    return this.chat.listMessages(
      customer.organizationId,
      customer.customerId,
      query.before,
      query.limit,
    );
  }

  @UseGuards(CustomerSessionGuard)
  @Post('messages')
  @HttpCode(HttpStatus.CREATED)
  // Tighter than the global limit: this is an unauthenticated-ish public
  // surface and the cheapest thing for someone to hammer.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async send(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Body() dto: SendMessageDto,
  ) {
    return this.chat.sendMessage(
      customer.organizationId,
      customer.customerId,
      dto.content,
      dto.clientMessageId,
    );
  }

  @UseGuards(CustomerSessionGuard)
  @Post('read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(@CurrentCustomer() customer: AuthenticatedCustomer): Promise<void> {
    await this.chat.markRead(customer.organizationId, customer.customerId);
  }

  /**
   * Customer asks for a human (master plan §53).
   *
   * Rate-limited with the message limit rather than the global one: it is the
   * same public surface and equally cheap to hammer.
   */
  @UseGuards(CustomerSessionGuard)
  @Post('request-human')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async requestHuman(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.chat.requestHuman(customer.organizationId, customer.customerId);
  }

  /** HTTP fallback for typing when the socket is down (docs/API.md §2). */
  @UseGuards(CustomerSessionGuard)
  @Post('typing')
  @HttpCode(HttpStatus.NO_CONTENT)
  async typing(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Body() dto: TypingDto,
  ): Promise<void> {
    await this.chat.setTyping(customer.organizationId, customer.customerId, dto.isTyping);
  }
}
