import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const DEFAULT_BIN = resolve(__dirname, "../vendor/piper/piper.exe");
const DEFAULT_MODEL = resolve(__dirname, "../vendor/models/pt_BR-faber-medium.onnx");

/**
 * Wrapper fino em cima do binario do Piper (TTS neural local, sem depender
 * de nenhuma API paga). O motor de voz e so mais um componente substituivel
 * do Planner Life: trocar de binario/modelo nunca deveria exigir mudar
 * quem chama VoiceService.
 */
@Injectable()
export class PiperService {
  private readonly logger = new Logger(PiperService.name);

  private get binPath(): string {
    return process.env.PIPER_BIN || DEFAULT_BIN;
  }

  private get modelPath(): string {
    return process.env.PIPER_MODEL || DEFAULT_MODEL;
  }

  private assertReady(): void {
    if (!existsSync(this.binPath)) {
      throw new InternalServerErrorException(
        `Binario do Piper nao encontrado em ${this.binPath}. Configure PIPER_BIN no .env ou rode o setup em packages/voice/README.md.`
      );
    }
    if (!existsSync(this.modelPath)) {
      throw new InternalServerErrorException(
        `Modelo de voz nao encontrado em ${this.modelPath}. Configure PIPER_MODEL no .env ou baixe um modelo (veja packages/voice/README.md).`
      );
    }
  }

  async synthesize(text: string): Promise<Buffer> {
    this.assertReady();
    const dir = await mkdtemp(join(tmpdir(), "planner-voice-"));
    const outputFile = join(dir, "speech.wav");

    try {
      await new Promise<void>((resolvePromise, reject) => {
        const proc = spawn(this.binPath, ["--model", this.modelPath, "--output_file", outputFile]);

        let stderr = "";
        proc.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        proc.on("error", reject);
        proc.on("close", (code) => {
          if (code === 0) {
            resolvePromise();
          } else {
            this.logger.error(stderr);
            reject(new Error(`piper saiu com codigo ${code}`));
          }
        });

        proc.stdin.write(text);
        proc.stdin.end();
      });

      return await readFile(outputFile);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
