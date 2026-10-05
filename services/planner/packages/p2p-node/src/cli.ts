import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { createPlannerNode, onPlpEvent, publishPlpEvent } from "./node.js";
import { createHttpBridge } from "./http-bridge.js";

const port = Number(process.env.P2P_TCP_PORT ?? 4400);
const httpPort = Number(process.env.P2P_HTTP_PORT ?? 4401);
const nodeName = process.env.P2P_NODE_NAME ?? "planner-node";

const node = await createPlannerNode({ port, nodeName });
const httpBridge = createHttpBridge(node, nodeName, httpPort);

console.log(`[p2p:${nodeName}] peer id: ${node.peerId.toString()}`);
console.log(
  `[p2p:${nodeName}] escutando em:`,
  node.getMultiaddrs().map((addr) => addr.toString())
);

onPlpEvent(node, (message) => {
  console.log(`[p2p:${nodeName}] evento recebido <- ${message.origin}: ${message.type}`, message.payload);
});

async function announcePresence() {
  try {
    await publishPlpEvent(node, "device.connected", nodeName, { nodeName, port });
  } catch {
    // Esperado quando ainda nao ha nenhum peer inscrito no topico PLP.
    console.log(`[p2p:${nodeName}] nenhum peer na rede ainda, aguardando...`);
  }
}

// Tenta anunciar presenca assim que sobe, e de novo a cada peer novo que
// conectar (o mesh do gossipsub leva um instante para se formar).
await announcePresence();
node.addEventListener("peer:connect", () => {
  void announcePresence();
});

process.on("SIGINT", async () => {
  console.log(`\n[p2p:${nodeName}] encerrando...`);
  httpBridge.close();
  await node.stop();
  process.exit(0);
});
