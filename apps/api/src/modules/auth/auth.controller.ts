import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthUser } from '../../common/auth-user';
import { CurrentUser, Public } from '../../common/decorators';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { DemoLoginDto, LoginDto, UpdateProfileDto } from './auth.dto';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle({ default: { limit: () => Number(process.env.LOGIN_RATE_LIMIT_PER_MINUTE ?? 10), ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in; sets an HttpOnly session cookie' })
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) response: Response) {
    return this.startSession(await this.auth.login(body.email, body.password), response);
  }

  @Public()
  @Get('demo-accounts')
  @ApiOperation({ summary: 'Seeded accounts for one-click sign-in (only when DEMO_LOGIN_ENABLED=true; 404 otherwise)' })
  demoAccounts() {
    return this.auth.demoAccounts();
  }

  @Public()
  @Throttle({ default: { limit: () => Number(process.env.LOGIN_RATE_LIMIT_PER_MINUTE ?? 10), ttl: 60_000 } })
  @Post('demo-login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in as a seeded account without a password (simulation only; 404 when disabled)' })
  async demoLogin(@Body() body: DemoLoginDto, @Res({ passthrough: true }) response: Response) {
    return this.startSession(await this.auth.demoLogin(body.email), response);
  }

  private async startSession(session: { token: string; expiresAt: Date }, response: Response) {
    response.cookie(this.config.session.cookieName, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.session.secureCookie,
      path: '/',
      expires: session.expiresAt,
    });
    const user = await this.sessions.authenticate(session.token);
    return this.auth.profile(user!);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Sign out and revoke the current session' })
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(user);
    response.clearCookie(this.config.session.cookieName, { path: '/' });
  }

  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Current user profile, roles and effective permissions' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.profile(user);
  }

  @Patch('me')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Update own name or password' })
  updateMe(@CurrentUser() user: AuthUser, @Body() body: UpdateProfileDto) {
    return this.auth.updateProfile(user, body);
  }
}
