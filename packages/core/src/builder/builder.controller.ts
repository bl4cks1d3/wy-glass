import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { BuilderService } from './builder.service';

type Body_ = Record<string, unknown>;

@Controller('builder')
export class BuilderController {
  constructor(private readonly builder: BuilderService) {}

  @Get('blocks')
  listBlocks() {
    return this.builder.listBlocks();
  }

  @Get('blocks/:id')
  getBlock(@Param('id') id: string) {
    return this.builder.getBlock(id);
  }

  @Post('blocks')
  createBlock(@Body() body: Body_) {
    return this.builder.createBlock(body ?? {});
  }

  @Post('blocks/:id/duplicate')
  duplicateBlock(@Param('id') id: string) {
    return this.builder.duplicateBlock(id);
  }

  @Patch('blocks/:id')
  updateBlock(@Param('id') id: string, @Body() body: Body_) {
    return this.builder.updateBlock(id, body ?? {});
  }

  @Delete('blocks/:id')
  removeBlock(@Param('id') id: string) {
    return this.builder.removeBlock(id);
  }

  @Get('dashboards')
  listDashboards() {
    return this.builder.listDashboards();
  }

  @Get('dashboards/:id')
  getDashboard(@Param('id') id: string) {
    return this.builder.getDashboard(id);
  }

  @Post('dashboards')
  createDashboard(@Body() body: Body_) {
    return this.builder.createDashboard(body ?? {});
  }

  @Post('dashboards/:id/duplicate')
  duplicateDashboard(@Param('id') id: string) {
    return this.builder.duplicateDashboard(id);
  }

  @Patch('dashboards/:id')
  updateDashboard(@Param('id') id: string, @Body() body: Body_) {
    return this.builder.updateDashboard(id, body ?? {});
  }

  @Delete('dashboards/:id')
  removeDashboard(@Param('id') id: string) {
    return this.builder.removeDashboard(id);
  }
}
