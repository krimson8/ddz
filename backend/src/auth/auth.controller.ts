import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { HttpAuthGuard, AuthedRequest } from './http-auth.guard';

@Controller('auth')
export class AuthController {
  @UseGuards(HttpAuthGuard)
  @Get('me')
  me(@Req() req: AuthedRequest) {
    return {
      uid: req.user.uid,
      email: req.user.email,
      nickname: req.user.nickname,
      avatarUrl: req.user.avatarUrl,
    };
  }
}
