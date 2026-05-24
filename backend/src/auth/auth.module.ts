import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { WsAuthGuard } from './ws-auth.guard';
import { HttpAuthGuard } from './http-auth.guard';
import { AuthController } from './auth.controller';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, WsAuthGuard, HttpAuthGuard],
  exports: [AuthService, WsAuthGuard, HttpAuthGuard],
})
export class AuthModule {}
