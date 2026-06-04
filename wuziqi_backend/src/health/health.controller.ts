import { Controller, Get } from '@nestjs/common';
import { GameService } from '../game/game.service';

@Controller()
export class HealthController {
  constructor(private readonly gameService: GameService) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      rooms: this.gameService.roomCount,
      uptime: Math.floor(process.uptime()),
    };
  }
}
