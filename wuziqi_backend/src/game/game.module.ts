import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';
import { RoomManager } from './room.manager';

@Module({
  providers: [RoomManager, GameService, GameGateway],
  exports: [GameService, RoomManager],
})
export class GameModule {}
