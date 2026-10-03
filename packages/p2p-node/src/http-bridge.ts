import { createServer } from "node:http";
import { publishPlpEvent, type PlannerLibp2pNode } from "./node.js";
import type { PlpEventType } from "@planner-life/shared";

/**
 * Ponte HTTP local (so 127.0.0.1) entre processos que nao falam libp2p e
 * este no P2P. O Planner Core chama POST /publish sempre que algo muda no
 * PlannerEventBus, e este bridge publica isso de verdade no topico PLP via
 * gossipsub -- e assim que uma mudanca no PC chega em outros dispositivos
 * da rede. Sem autenticacao porque so aceita conexoes locais.
 */
export function createHttpBridge(node: PlannerLibp2pNode, nodeName: string, port: number) {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "planner-p2p-node", peerId: node.peerId.toString() }));
      return;
    }

    if (req.method === "POST" && req.url === "/publish") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const { type, payload } = JSON.parse(body) as { type: PlpEventType; payload: Record<string, unknown> };
          await publishPlpEvent(node, type, nodeName, payload ?? {});
          console.log(`[p2p:${nodeName}] core -> rede: ${type}`, payload);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          // Erro mais comum: nenhum peer inscrito no topico ainda -- nao e
          // uma falha real, so significa que ninguem mais esta na rede.
          const reason = err instanceof Error ? err.message : String(err);
          console.log(`[p2p:${nodeName}] core -> rede: falhou (${reason})`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, reason }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[p2p:${nodeName}] bridge HTTP em http://127.0.0.1:${port} (usado pelo Planner Core)`);
  });

  return server;
}
