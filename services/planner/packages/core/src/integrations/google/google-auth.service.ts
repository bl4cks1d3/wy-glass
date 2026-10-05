import { Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import type { PlannerDb } from "../../db";
import { PLANNER_DB } from "../../database/database.module";
import {
  deleteIntegrationToken,
  getIntegrationToken,
  listIntegrationTokensByPrefix,
  saveIntegrationToken,
} from "../../repositories/integration-tokens";

const KEY_PREFIX = "google:";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  // calendar (nao so calendar.readonly) -- o agente cria/move/cancela evento,
  // nao so le. Contas conectadas antes dessa mudanca precisam reconectar.
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export interface GoogleAccount {
  email: string;
  connectedAt: string;
}

/**
 * Fluxo OAuth do Google feito com fetch puro (sem SDK). Suporta MAIS DE UMA
 * conta conectada ao mesmo tempo: cada token e guardado sob a chave
 * "google:<email>", entao repetir o fluxo de /auth com prompt=select_account
 * deixa o usuario escolher outra conta Google e conectar as duas.
 */
@Injectable()
export class GoogleAuthService {
  constructor(@Inject(PLANNER_DB) private readonly db: PlannerDb) {}

  private get clientId(): string {
    const id = process.env.GOOGLE_CLIENT_ID;
    if (!id) throw new InternalServerErrorException("GOOGLE_CLIENT_ID nao configurado no .env");
    return id;
  }

  private get clientSecret(): string {
    const secret = process.env.GOOGLE_CLIENT_SECRET;
    if (!secret) throw new InternalServerErrorException("GOOGLE_CLIENT_SECRET nao configurado no .env");
    return secret;
  }

  private get redirectUri(): string {
    return process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:4000/integrations/google/callback";
  }

  buildAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      // select_account forca o Google a mostrar o seletor de conta mesmo se
      // ja houver uma sessao ativa -- e o que permite conectar uma segunda
      // conta em vez de sempre reautorizar a mesma.
      prompt: "consent select_account",
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  /**
   * Troca o code por tokens e descobre qual conta foi autorizada (via
   * userinfo), retornando o e-mail para quem chamou poder confirmar.
   */
  async exchangeCode(code: string): Promise<string> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) {
      throw new InternalServerErrorException(`falha ao trocar code por token: ${await res.text()}`);
    }
    const data = (await res.json()) as TokenResponse;

    const userinfoRes = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (!userinfoRes.ok) {
      throw new InternalServerErrorException(`falha ao identificar a conta Google: ${await userinfoRes.text()}`);
    }
    const userinfo = (await userinfoRes.json()) as { email: string };

    this.storeToken(userinfo.email, data);
    return userinfo.email;
  }

  private storeToken(email: string, data: TokenResponse): void {
    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
    saveIntegrationToken(this.db, {
      provider: `${KEY_PREFIX}${email}`,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
      scope: data.scope,
    });
  }

  listAccounts(): GoogleAccount[] {
    return listIntegrationTokensByPrefix(this.db, KEY_PREFIX).map((t) => ({
      email: t.provider.slice(KEY_PREFIX.length),
      connectedAt: t.updatedAt,
    }));
  }

  isConnected(): boolean {
    return this.listAccounts().length > 0;
  }

  disconnect(email: string): void {
    deleteIntegrationToken(this.db, `${KEY_PREFIX}${email}`);
  }

  /**
   * Retorna um access_token valido para a conta indicada, renovando via
   * refresh_token se o atual ja expirou (ou esta a menos de 60s de expirar).
   */
  async getValidAccessToken(email: string): Promise<string> {
    const key = `${KEY_PREFIX}${email}`;
    const token = getIntegrationToken(this.db, key);
    if (!token) {
      throw new InternalServerErrorException(`Conta Google "${email}" nao esta conectada.`);
    }
    const expiresAt = token.expiresAt ? new Date(token.expiresAt).getTime() : 0;
    if (expiresAt - Date.now() > 60_000) {
      return token.accessToken;
    }
    if (!token.refreshToken) {
      throw new InternalServerErrorException(
        `Token da conta "${email}" expirou e nao ha refresh_token salvo. Reautorize em /integrations/google/auth.`
      );
    }

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: token.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      throw new InternalServerErrorException(`falha ao renovar token de "${email}": ${await res.text()}`);
    }
    const data = (await res.json()) as TokenResponse;
    this.storeToken(email, { ...data, refresh_token: data.refresh_token ?? token.refreshToken });
    return data.access_token;
  }
}
