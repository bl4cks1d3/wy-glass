import { Module } from "@nestjs/common";
import { P2pBridgeService } from "./p2p-bridge.service";

@Module({
  providers: [P2pBridgeService],
})
export class P2pBridgeModule {}
