import { BadRequestException, Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { assertLocalCaller, type LocalRequest } from '../local-guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('pending')
  listPending() {
    return this.notifications.listPending();
  }

  /** Aviso personalizado (automacoes, MCP, blocos): aparece como toast + notificacao do sistema + som. */
  @Post()
  push(@Req() req: LocalRequest, @Body() body: { title?: unknown; body?: unknown }) {
    assertLocalCaller(req);
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 120) : '';
    const text = typeof body?.body === 'string' ? body.body.trim().slice(0, 500) : '';
    if (!text) throw new BadRequestException('body e obrigatorio');
    return this.notifications.push(title || 'Planner Life', text);
  }

  @Post(':id/ack')
  ack(@Param('id') id: string) {
    this.notifications.ack(id);
    return { ok: true };
  }
}
