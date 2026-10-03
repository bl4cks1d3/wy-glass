import { BadRequestException, Body, Controller, Get, HttpCode, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { PiperService } from "./piper.service";

@Controller()
export class VoiceController {
  constructor(private readonly piper: PiperService) {}

  @Get("health")
  health() {
    return { ok: true, service: "planner-voice" };
  }

  @Post("speak")
  @HttpCode(200)
  async speak(@Body() body: { text?: string }, @Res() res: Response) {
    if (!body?.text) {
      throw new BadRequestException("text e obrigatorio");
    }
    const audio = await this.piper.synthesize(body.text);
    res.setHeader("Content-Type", "audio/wav");
    res.send(audio);
  }
}
