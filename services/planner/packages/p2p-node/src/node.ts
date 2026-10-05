import { createLibp2p, type Libp2p } from "libp2p";
import { tcp } from "@libp2p/tcp";
import { mdns } from "@libp2p/mdns";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { gossipsub, type GossipsubEvents } from "@chainsafe/libp2p-gossipsub";
import { identify, type Identify } from "@libp2p/identify";
import type { PubSub } from "@libp2p/interface";
import { PLP_TOPIC, createPlpMessage, type PlpMessage } from "@planner-life/shared";

export interface PlannerNodeOptions {
  port?: number;
  nodeName?: string;
}

type PubsubServices = {
  pubsub: PubSub<GossipsubEvents>;
  identify: Identify;
};

export type PlannerLibp2pNode = Libp2p<PubsubServices>;

/**
 * Cria um no da rede Planner Life (PLP). O mesmo codigo roda tanto no PC
 * principal quanto no Raspberry Pi: cada processo vira um peer que descobre
 * os outros na rede local via mDNS e troca eventos PLP via gossipsub.
 */
export async function createPlannerNode(
  options: PlannerNodeOptions = {}
): Promise<PlannerLibp2pNode> {
  const port = options.port ?? 4400;
  const nodeName = options.nodeName ?? "planner-node";

  const node = await createLibp2p({
    addresses: {
      listen: [`/ip4/0.0.0.0/tcp/${port}`],
    },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [mdns({ interval: 5000, serviceTag: "planner-life" })],
    services: {
      identify: identify(),
      pubsub: gossipsub({ emitSelf: false }),
    },
  });

  await node.services.pubsub.subscribe(PLP_TOPIC);

  node.addEventListener("peer:discovery", (evt) => {
    console.log(`[p2p:${nodeName}] peer descoberto: ${evt.detail.id.toString()}`);
    // mDNS so avisa que o peer existe -- quem conecta de verdade e o dial
    // explicito abaixo (sem isso, dois nos podem se "descobrir" para
    // sempre sem nunca trocar uma mensagem PLP).
    node.dial(evt.detail.multiaddrs).catch((err) => {
      console.log(`[p2p:${nodeName}] falha ao conectar em ${evt.detail.id.toString()}: ${err instanceof Error ? err.message : err}`);
    });
  });

  node.addEventListener("peer:connect", (evt) => {
    console.log(`[p2p:${nodeName}] peer conectado: ${evt.detail.toString()}`);
  });

  return node;
}

export function publishPlpEvent(
  node: PlannerLibp2pNode,
  type: string,
  origin: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  const message = createPlpMessage(type, origin, payload);
  const data = new TextEncoder().encode(JSON.stringify(message));
  return node.services.pubsub.publish(PLP_TOPIC, data);
}

export function onPlpEvent(
  node: PlannerLibp2pNode,
  handler: (message: PlpMessage) => void
): void {
  node.services.pubsub.addEventListener("message", (evt) => {
    if (evt.detail.topic !== PLP_TOPIC) return;
    try {
      const text = new TextDecoder().decode(evt.detail.data);
      handler(JSON.parse(text) as PlpMessage);
    } catch (err) {
      console.error("[p2p] falha ao decodificar mensagem PLP", err);
    }
  });
}
