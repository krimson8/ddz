import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameService } from './game.service';
import { Card } from './types';

const ALLOWED_REACTIONS = new Set([
  '🖕', '🤏', '🤌',
  '我操', 'EZ', 'GG', '什麼lin', '你會玩的嗎', '小癟三', '不用看了',
  '窩妖驗牌', '牌沒有問題', '在我者離', '給我搽皮鞋',
]);
const VALID_SUITS = new Set<string>([
  'spade',
  'heart',
  'diamond',
  'club',
  'joker',
]);

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class GameGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  /** Fixed 1-second window event counter per socket (max 10 events/s). */
  private readonly eventWindows = new Map<
    string,
    { count: number; windowStart: number }
  >();

  /** Last emoji send timestamp per socket (max 1 per 3 s). */
  private readonly emojiTimestamps = new Map<string, number>();

  constructor(private readonly gameService: GameService) {}

  afterInit(server: Server): void {
    this.gameService.setServer(server);
  }

  handleDisconnect(socket: Socket): void {
    this.gameService.handleDisconnect(socket.id);
    this.eventWindows.delete(socket.id);
    this.emojiTimestamps.delete(socket.id);
  }

  // ── Rate-limit helpers ───────────────────────────────────────────────────────

  /**
   * Returns true if this socket has exceeded 10 events in the current
   * 1-second window. Resets the window automatically after 1 s.
   */
  private isRateLimited(socketId: string): boolean {
    const now = Date.now();
    let entry = this.eventWindows.get(socketId);
    if (!entry) {
      this.eventWindows.set(socketId, { count: 1, windowStart: now });
      return false;
    }
    if (now - entry.windowStart > 1_000) {
      entry.count = 1;
      entry.windowStart = now;
      return false;
    }
    entry.count++;
    return entry.count > 10;
  }

  private rejectRateLimit(socket: Socket): void {
    socket.emit('room_error', { message: '訊息頻率過高，請稍後再試' });
  }

  // ── create_room ──────────────────────────────────────────────────────────────

  @SubscribeMessage('create_room')
  handleCreateRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: unknown,
  ): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }

    const nickname = extractString(payload, 'nickname');
    const result = this.gameService.handleCreateRoom(socket.id, nickname);

    if ('error' in result) {
      socket.emit('room_error', { message: result.error });
      return;
    }

    console.log('[create_room] socket.id:', socket.id, 'roomCode:', result.roomCode, 'reconnectToken:', result.reconnectToken);
    void socket.join(result.roomCode);

    socket.emit('room_created', {
      roomCode: result.roomCode,
      reconnectToken: result.reconnectToken,
    });

    const joined = this.gameService.buildRoomJoinedPayload(
      socket.id,
      result.roomCode,
    );
    if (joined) {
      socket.emit('room_joined', {
        ...joined,
        reconnectToken: result.reconnectToken,
        nickname: result.nickname,
      });
    }
  }

  // ── join_room ────────────────────────────────────────────────────────────────

  @SubscribeMessage('join_room')
  handleJoinRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: unknown,
  ): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }

    const roomCode = extractString(payload, 'code');
    const nickname = extractString(payload, 'nickname');
    const result = this.gameService.handleJoinRoom(socket.id, roomCode, nickname);

    if ('error' in result) {
      socket.emit('room_error', { message: result.error });
      return;
    }

    void socket.join(result.roomCode);

    const joined = this.gameService.buildRoomJoinedPayload(
      socket.id,
      result.roomCode,
    );
    if (joined) {
      socket.emit('room_joined', {
        ...joined,
        reconnectToken: result.reconnectToken,
        nickname: result.nickname,
      });
    }
  }

  // ── reconnect ────────────────────────────────────────────────────────────────

  @SubscribeMessage('rejoin')
  handleReconnect(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: unknown,
  ): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }

    const reconnectToken = extractString(payload, 'reconnectToken');
    const roomCode = extractString(payload, 'code');
    console.log('[reconnect] socket.id:', socket.id, 'roomCode:', roomCode, 'token:', reconnectToken);
    const result = this.gameService.handleReconnect(
      socket.id,
      reconnectToken,
      roomCode,
    );
    console.log('[reconnect] result:', result);

    if (!result) {
      socket.emit('room_error', { message: '重連失敗，找不到對應的遊戲階段' });
      return;
    }

    void socket.join(result.roomCode);
    this.gameService.emitReconnectState(socket.id, result.roomCode, result.wasDisconnected);
  }

  // ── vote_play ────────────────────────────────────────────────────────────────

  @SubscribeMessage('vote_play')
  handleVotePlay(@ConnectedSocket() socket: Socket): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }
    this.gameService.handleVotePlay(socket.id);
  }

  // ── bid ──────────────────────────────────────────────────────────────────────

  @SubscribeMessage('bid')
  handleBid(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: unknown,
  ): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }

    const p = asRecord(payload);
    const rawValue = p?.value;
    if (rawValue !== 0 && rawValue !== 1) {
      socket.emit('room_error', { message: '無效的投票值' });
      return;
    }

    this.gameService.handleBid(socket.id, rawValue as 0 | 1);
  }

  // ── play_cards ───────────────────────────────────────────────────────────────

  @SubscribeMessage('play_cards')
  handlePlayCards(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: unknown,
  ): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }

    const p = asRecord(payload);
    const rawCards = p?.cards;

    if (
      !Array.isArray(rawCards) ||
      rawCards.length === 0 ||
      rawCards.length > 20
    ) {
      socket.emit('invalid_play', { reason: '無效的牌組' });
      return;
    }

    const cards: Card[] = [];
    for (const c of rawCards) {
      const card = asRecord(c);
      if (!card) {
        socket.emit('invalid_play', { reason: '無效的牌' });
        return;
      }

      const { suit, rank } = card;
      if (
        typeof suit !== 'string' ||
        !VALID_SUITS.has(suit) ||
        typeof rank !== 'number' ||
        !Number.isInteger(rank) ||
        rank < 3 ||
        rank > 17
      ) {
        socket.emit('invalid_play', { reason: '無效的牌' });
        return;
      }

      cards.push({ suit: suit as Card['suit'], rank });
    }

    this.gameService.handlePlayCards(socket.id, cards);
  }

  // ── pass ─────────────────────────────────────────────────────────────────────

  @SubscribeMessage('pass')
  handlePass(@ConnectedSocket() socket: Socket): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }
    this.gameService.handlePass(socket.id);
  }

  // ── react_emoji ───────────────────────────────────────────────────────────────

  @SubscribeMessage('react_emoji')
  handleReactEmoji(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: unknown,
  ): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }

    const emoji = extractString(payload, 'emoji');
    if (!ALLOWED_REACTIONS.has(emoji)) {
      socket.emit('room_error', { message: '無效的反應' });
      return;
    }

    // Per-socket 500ms cooldown — silently drop (no error, per spec §8)
    const now = Date.now();
    const last = this.emojiTimestamps.get(socket.id) ?? 0;
    if (now - last < 500) return;
    this.emojiTimestamps.set(socket.id, now);

    this.gameService.handleReactEmoji(socket.id, emoji);
  }

  // ── leave_room ────────────────────────────────────────────────────────────────

  @SubscribeMessage('leave_room')
  handleLeaveRoom(@ConnectedSocket() socket: Socket): void {
    // Intentionally NOT rate-limited — leaving must always be allowed
    const roomCode = this.getGameRoomCode(socket);
    this.gameService.handleLeaveRoom(socket.id);
    if (roomCode) void socket.leave(roomCode);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /** Returns the game room code the socket is in (excluding its own socket room). */
  private getGameRoomCode(socket: Socket): string {
    for (const r of socket.rooms) {
      if (r !== socket.id) return r;
    }
    return '';
  }
}

// ── Module-level pure helpers ─────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function extractString(payload: unknown, key: string): string {
  const p = asRecord(payload);
  return typeof p?.[key] === 'string' ? (p[key] as string) : '';
}
