import { Module } from "@nestjs/common";
import { VoiceController } from "./voice.controller";
import { PiperService } from "./piper.service";

@Module({
  controllers: [VoiceController],
  providers: [PiperService],
})
export class AppModule {}
