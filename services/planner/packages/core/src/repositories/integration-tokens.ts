import type { PlannerDb } from "../db";

export interface IntegrationToken {
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  updatedAt: string;
}

interface TokenRow {
  provider: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
  updated_at: string;
}

function rowToToken(row: TokenRow): IntegrationToken {
  return {
    provider: row.provider,
    accessToken: row.access_token,
    refreshToken: row.refresh_token ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    scope: row.scope ?? undefined,
    updatedAt: row.updated_at,
  };
}

export function saveIntegrationToken(
  db: PlannerDb,
  input: {
    provider: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
    scope?: string;
  }
): IntegrationToken {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO integration_tokens (provider, access_token, refresh_token, expires_at, scope, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, integration_tokens.refresh_token),
       expires_at = excluded.expires_at,
       scope = excluded.scope,
       updated_at = excluded.updated_at`
  ).run(
    input.provider,
    input.accessToken,
    input.refreshToken ?? null,
    input.expiresAt ?? null,
    input.scope ?? null,
    now
  );
  return getIntegrationToken(db, input.provider) as IntegrationToken;
}

export function getIntegrationToken(db: PlannerDb, provider: string): IntegrationToken | undefined {
  const row = db.prepare(`SELECT * FROM integration_tokens WHERE provider = ?`).get(provider) as
    | TokenRow
    | undefined;
  return row ? rowToToken(row) : undefined;
}

/**
 * Lista tokens cuja chave comece com um prefixo (ex: "google:" para achar
 * todas as contas Google conectadas, ja que cada conta usa a chave
 * "google:<email>"). Permite guardar mais de uma conta do mesmo provider.
 */
export function listIntegrationTokensByPrefix(db: PlannerDb, prefix: string): IntegrationToken[] {
  const rows = db
    .prepare(`SELECT * FROM integration_tokens WHERE provider LIKE ? ORDER BY updated_at DESC`)
    .all(`${prefix}%`) as unknown as TokenRow[];
  return rows.map(rowToToken);
}

export function deleteIntegrationToken(db: PlannerDb, provider: string): void {
  db.prepare(`DELETE FROM integration_tokens WHERE provider = ?`).run(provider);
}
