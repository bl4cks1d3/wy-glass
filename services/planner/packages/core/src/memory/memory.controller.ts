import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { MemoryService } from "./memory.service";

@Controller("memory")
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get()
  list(@Query("limit") limit?: string) {
    return this.memoryService.list(limit ? Number(limit) : 100);
  }

  @Post()
  create(@Body() body: { content?: string; tags?: string[]; source?: string }) {
    if (!body?.content) {
      throw new BadRequestException("content e obrigatorio");
    }
    return this.memoryService.create({
      content: body.content,
      tags: body.tags,
      source: body.source,
    });
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.memoryService.remove(id);
  }
}
