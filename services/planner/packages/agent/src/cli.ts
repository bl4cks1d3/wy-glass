import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "../../../.env") });
import "reflect-metadata";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AgentService } from "./agent.service";

async function main() {
  const appContext = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  const agent = appContext.get(AgentService);

  console.log("Planner Life - Personal Agent");
  console.log('Converse comigo. Digite "sair" para encerrar.\n');

  const rl = createInterface({ input: stdin, output: stdout });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const message = await rl.question("voce> ");
    if (["sair", "exit", "quit"].includes(message.trim().toLowerCase())) {
      break;
    }
    const reply = await agent.chat(message);
    console.log(`\nagente> ${reply}\n`);
  }

  rl.close();
  await appContext.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
