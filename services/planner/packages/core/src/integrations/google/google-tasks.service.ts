import { Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { GoogleAuthService } from "./google-auth.service";

const TASKS_API = "https://tasks.googleapis.com/tasks/v1";

export interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  due?: string;
  status: "needsAction" | "completed";
  account: string;
}

interface GTasksListResponse {
  items?: {
    id: string;
    title?: string;
    notes?: string;
    due?: string;
    status?: "needsAction" | "completed";
  }[];
}

/**
 * CRUD completo sobre o Google Tasks (lista "@default" de cada conta
 * conectada), pelo mesmo token OAuth ja usado para Gmail/Calendar. Diferente
 * do inbox, aqui nao guardamos copia local -- e sempre live, porque tarefas
 * do Google sao editadas em varios lugares (celular, web) e uma copia local
 * ficaria desatualizada rapido.
 */
@Injectable()
export class GoogleTasksService {
  constructor(private readonly googleAuth: GoogleAuthService) {}

  private defaultAccount(): string {
    const [account] = this.googleAuth.listAccounts();
    if (!account) {
      throw new NotFoundException("Nenhuma conta Google conectada.");
    }
    return account.email;
  }

  private async tasksFetch(path: string, email: string, init?: RequestInit) {
    const accessToken = await this.googleAuth.getValidAccessToken(email);
    const res = await fetch(`${TASKS_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new InternalServerErrorException(`Google Tasks API respondeu ${res.status}: ${await res.text()}`);
    }
    if (res.status === 204) return undefined;
    return res.json();
  }

  async list(email?: string): Promise<GoogleTask[]> {
    const account = email ?? this.defaultAccount();
    const data = (await this.tasksFetch("/lists/@default/tasks?showCompleted=true&showHidden=true", account)) as
      | GTasksListResponse
      | undefined;
    return (data?.items ?? []).map((t) => ({
      id: t.id,
      title: t.title ?? "(sem titulo)",
      notes: t.notes,
      due: t.due,
      status: t.status ?? "needsAction",
      account,
    }));
  }

  async create(input: { title: string; notes?: string; due?: string; account?: string }): Promise<GoogleTask> {
    const account = input.account ?? this.defaultAccount();
    const data = (await this.tasksFetch("/lists/@default/tasks", account, {
      method: "POST",
      body: JSON.stringify({ title: input.title, notes: input.notes, due: input.due }),
    })) as { id: string; title: string; notes?: string; due?: string; status?: "needsAction" | "completed" };
    return {
      id: data.id,
      title: data.title,
      notes: data.notes,
      due: data.due,
      status: data.status ?? "needsAction",
      account,
    };
  }

  async update(
    id: string,
    input: { title?: string; notes?: string; due?: string; status?: "needsAction" | "completed"; account?: string }
  ): Promise<GoogleTask> {
    const account = input.account ?? this.defaultAccount();
    const data = (await this.tasksFetch(`/lists/@default/tasks/${id}`, account, {
      method: "PATCH",
      body: JSON.stringify({
        title: input.title,
        notes: input.notes,
        due: input.due,
        status: input.status,
      }),
    })) as { id: string; title: string; notes?: string; due?: string; status?: "needsAction" | "completed" };
    return {
      id: data.id,
      title: data.title,
      notes: data.notes,
      due: data.due,
      status: data.status ?? "needsAction",
      account,
    };
  }

  async remove(id: string, email?: string): Promise<void> {
    const account = email ?? this.defaultAccount();
    await this.tasksFetch(`/lists/@default/tasks/${id}`, account, { method: "DELETE" });
  }
}
