import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { GoogleAuthService } from "./google-auth.service";
import { MessagesService } from "../../messages/messages.service";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailListResponse {
  messages?: { id: string; threadId: string }[];
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessageResponse {
  id: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[] } & GmailPart;
}

function header(msg: GmailMessageResponse, name: string): string | undefined {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

/** Anda pela arvore de partes MIME procurando texto (junta plain e html separados). */
function extractBody(part: GmailPart | undefined): { text: string; html: string } {
  if (!part) return { text: "", html: "" };
  let plain = "";
  let html = "";

  function walk(p: GmailPart) {
    if (p.mimeType === "text/plain" && p.body?.data) {
      plain += decodeBase64Url(p.body.data);
    } else if (p.mimeType === "text/html" && p.body?.data) {
      html += decodeBase64Url(p.body.data);
    } else if (p.parts) {
      p.parts.forEach(walk);
    } else if (p.body?.data && !p.mimeType?.startsWith("image/") && !p.mimeType?.startsWith("application/")) {
      plain += decodeBase64Url(p.body.data);
    }
  }
  walk(part);

  return { text: plain.trim(), html: html.trim() };
}

@Injectable()
export class GmailService {
  constructor(
    private readonly googleAuth: GoogleAuthService,
    private readonly messagesService: MessagesService
  ) {}

  private async gmailFetch(path: string, accessToken: string) {
    const res = await fetch(`${GMAIL_API}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new InternalServerErrorException(`Gmail API respondeu ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  /**
   * Busca o corpo completo de um e-mail especifico -- so quando o usuario
   * pede pra ler. Devolve texto e HTML separados: o dashboard renderiza o
   * HTML (num iframe sandboxed, pra ficar igual ao e-mail de verdade sem
   * rodar script nenhum) e cai pro texto simples se o e-mail nao tiver HTML.
   */
  async getMessageBody(
    email: string,
    gmailMessageId: string
  ): Promise<{ from: string; subject: string; text: string; html: string }> {
    const accessToken = await this.googleAuth.getValidAccessToken(email);
    const detail = (await this.gmailFetch(`/messages/${gmailMessageId}?format=full`, accessToken)) as GmailMessageResponse;
    const { text, html } = extractBody(detail.payload);
    return {
      from: header(detail, "From") ?? "desconhecido",
      subject: header(detail, "Subject") ?? "(sem assunto)",
      text: text || detail.snippet || "(sem conteudo legivel)",
      html,
    };
  }

  /** Sincroniza uma conta especifica. */
  private async syncAccount(email: string, limit: number): Promise<number> {
    const accessToken = await this.googleAuth.getValidAccessToken(email);

    const list = (await this.gmailFetch(
      `/messages?maxResults=${limit}&labelIds=INBOX`,
      accessToken
    )) as GmailListResponse;

    const ids = list.messages ?? [];
    let synced = 0;
    for (const { id } of ids) {
      const detail = (await this.gmailFetch(
        `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        accessToken
      )) as GmailMessageResponse;

      const from = header(detail, "From") ?? "desconhecido";
      const subject = header(detail, "Subject") ?? "(sem assunto)";
      const receivedAt = detail.internalDate
        ? new Date(Number(detail.internalDate)).toISOString()
        : new Date().toISOString();

      this.messagesService.upsert({
        id: `gmail-${email}-${detail.id}`,
        from,
        subject,
        snippet: detail.snippet,
        tag: email,
        receivedAt,
      });
      synced++;
    }

    return synced;
  }

  /** Sincroniza todas as contas Google conectadas (ou so uma, se informada). */
  async syncInbox(limit = 10, onlyAccount?: string): Promise<{ synced: number; accounts: string[] }> {
    const accounts = onlyAccount ? [onlyAccount] : this.googleAuth.listAccounts().map((a) => a.email);
    let total = 0;
    for (const email of accounts) {
      total += await this.syncAccount(email, limit);
    }
    return { synced: total, accounts };
  }
}
