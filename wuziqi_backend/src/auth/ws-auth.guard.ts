import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { AuthService, AuthedUser } from './auth.service';

export interface SocketData {
  user?: AuthedUser;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AuthedSocket = Socket<any, any, any, SocketData>;

/**
 * Verifies the Firebase ID token from socket.handshake.auth.token
 * and attaches the AuthedUser to socket.data.user.
 *
 * Only runs once per socket (cached on socket.data.user).
 * Emits 'room_error' and returns false on rejection — caller (Nest) drops the message.
 */
@Injectable()
export class WsAuthGuard implements CanActivate {
  private readonly logger = new Logger(WsAuthGuard.name);

  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const socket = context.switchToWs().getClient<AuthedSocket>();

    if (socket.data.user) return true;

    const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
    if (!token) {
      socket.emit('auth_error', { message: '未登入' });
      socket.disconnect();
      return false;
    }

    try {
      const user = await this.authService.authenticate(token);
      socket.data.user = user;
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Auth failed';
      this.logger.warn(`WS auth failed: ${msg}`);
      socket.emit('auth_error', { message: '驗證失敗' });
      socket.disconnect();
      return false;
    }
  }
}
