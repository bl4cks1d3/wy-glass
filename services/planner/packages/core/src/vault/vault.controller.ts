import { BadRequestException, Body, Controller, Delete, Get, Post, Query } from "@nestjs/common";
import { VaultService } from "./vault.service";

@Controller("vault")
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Get("notes")
  list() {
    return this.vault.list();
  }

  @Get("note")
  read(@Query("path") path?: string) {
    if (!path) throw new BadRequestException("path e obrigatorio");
    return this.vault.read(path);
  }

  @Post("note")
  write(@Body() body: { path?: string; content?: string }) {
    if (!body?.path || body.content === undefined) {
      throw new BadRequestException("path e content sao obrigatorios");
    }
    return this.vault.write(body.path, body.content);
  }

  @Delete("note")
  remove(@Query("path") path?: string) {
    if (!path) throw new BadRequestException("path e obrigatorio");
    this.vault.remove(path);
    return { ok: true };
  }

  @Get("search")
  search(@Query("q") q?: string) {
    if (!q?.trim()) return [];
    return this.vault.search(q);
  }
}
