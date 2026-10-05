import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "../../../.env") });

import { writeFile } from "node:fs/promises";
import { PiperService } from "./piper.service";

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const text = args[0];
  const outputPath = args[1] ?? "speech.wav";

  if (!text) {
    console.error('Uso: pnpm --filter @planner-life/voice cli -- "texto para falar" [saida.wav]');
    process.exit(1);
  }

  const piper = new PiperService();
  const audio = await piper.synthesize(text);
  await writeFile(outputPath, audio);
  console.log(`Audio salvo em ${resolve(outputPath)} (${audio.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
