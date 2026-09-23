import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, LogoutDto, RefreshDto } from './dto';
import { CurrentUser, Public } from '@/shared/decorators';
import type { AuthenticatedUser } from '@/shared/interfaces';

/**
 * Controllers stay thin (master plan §49.5): parse, delegate, return.
 * All behaviour lives in AuthService.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private contextFrom(request: Request) {
    return {
      userAgent: request.headers['user-agent'] ?? null,
      ip: request.ip ?? null,
    };
  }

  // Brute-force protection comes from the named 'auth' throttler in
  // AppModule, driven by AUTH_RATE_LIMIT_MAX. Deliberately not a @Throttle
  // decorator here: a hardcoded number would make that env var dead config.
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.auth.login(dto.email, dto.password, dto.organizationSlug, this.contextFrom(request));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto, @Req() request: Request) {
    return this.auth.refresh(dto.refreshToken, this.contextFrom(request));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body() dto: LogoutDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.auth.logout(dto.refreshToken, user.id);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
