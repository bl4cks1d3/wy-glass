import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { GoogleAuthService } from "./google-auth.service";

const CALENDAR_LIST_API = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const CALENDAR_EVENTS_API = "https://www.googleapis.com/calendar/v3/calendars";

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  location?: string;
  account: string;
  calendarName: string;
}

interface GCalListResponse {
  items?: { id: string; summary?: string; selected?: boolean; deleted?: boolean }[];
}

interface GCalEventDetail {
  id: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

interface GCalEventsResponse {
  items?: GCalEventDetail[];
}

@Injectable()
export class CalendarService {
  constructor(private readonly googleAuth: GoogleAuthService) {}

  private async googleFetch(url: string, email: string, init?: RequestInit) {
    const accessToken = await this.googleAuth.getValidAccessToken(email);
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new InternalServerErrorException(`Calendar API respondeu ${res.status}: ${await res.text()}`);
    }
    if (res.status === 204) return undefined;
    return res.json();
  }

  private defaultAccount(): string {
    const [account] = this.googleAuth.listAccounts();
    if (!account) {
      throw new NotFoundException("Nenhuma conta Google conectada.");
    }
    return account.email;
  }

  /** O id de evento exposto pro resto do app e "calendarId:eventId" (ver listEventsFromCalendar). */
  private splitCompositeId(compositeId: string): { calendarId: string; eventId: string } {
    const idx = compositeId.indexOf(":");
    if (idx === -1) throw new BadRequestException("id de evento invalido");
    return { calendarId: compositeId.slice(0, idx), eventId: compositeId.slice(idx + 1) };
  }

  /**
   * Todas as agendas visiveis na conta (a propria + secundarias + as
   * compartilhadas que o usuario ja tem habilitadas no Google Calendar --
   * e assim que a agenda da familia, por exemplo, aparece aqui tambem).
   */
  private async listCalendars(email: string): Promise<{ id: string; name: string }[]> {
    const data = (await this.googleFetch(CALENDAR_LIST_API, email)) as GCalListResponse;
    return (data.items ?? [])
      .filter((c) => !c.deleted && c.selected !== false)
      .map((c) => ({ id: c.id, name: c.summary ?? c.id }));
  }

  private async listEventsFromCalendar(
    email: string,
    calendarId: string,
    calendarName: string,
    maxResults: number
  ): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({
      timeMin: new Date().toISOString(),
      maxResults: String(maxResults),
      singleEvents: "true",
      orderBy: "startTime",
    });
    const url = `${CALENDAR_EVENTS_API}/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
    const data = (await this.googleFetch(url, email).catch(() => ({ items: [] }))) as GCalEventsResponse;
    return (data.items ?? []).map((item) => ({
      id: `${calendarId}:${item.id}`,
      title: item.summary ?? "(sem titulo)",
      start: item.start?.dateTime ?? item.start?.date ?? new Date().toISOString(),
      end: item.end?.dateTime ?? item.end?.date,
      location: item.location,
      account: email,
      calendarName,
    }));
  }

  private async listForAccount(email: string, maxResults: number): Promise<CalendarEvent[]> {
    const calendars = await this.listCalendars(email);
    const perCalendar = await Promise.all(
      calendars.map((cal) => this.listEventsFromCalendar(email, cal.id, cal.name, maxResults))
    );
    return perCalendar.flat();
  }

  async listUpcoming(maxResults = 10): Promise<CalendarEvent[]> {
    const accounts = this.googleAuth.listAccounts().map((a) => a.email);
    const perAccount = await Promise.all(
      accounts.map((email) => this.listForAccount(email, maxResults).catch(() => []))
    );
    return perAccount
      .flat()
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, maxResults);
  }

  /** Cria sempre no calendario "primary" (agenda pessoal principal da conta). */
  async create(input: {
    title: string;
    start: string;
    end: string;
    description?: string;
    account?: string;
  }): Promise<CalendarEvent> {
    const account = input.account ?? this.defaultAccount();
    const data = (await this.googleFetch(`${CALENDAR_EVENTS_API}/primary/events`, account, {
      method: "POST",
      body: JSON.stringify({
        summary: input.title,
        description: input.description,
        start: { dateTime: input.start },
        end: { dateTime: input.end },
      }),
    })) as GCalEventDetail;
    return {
      id: `primary:${data.id}`,
      title: data.summary ?? input.title,
      start: data.start?.dateTime ?? input.start,
      end: data.end?.dateTime ?? input.end,
      location: data.location,
      account,
      calendarName: "primary",
    };
  }

  async update(
    compositeId: string,
    input: { title?: string; start?: string; end?: string; description?: string; account?: string }
  ): Promise<CalendarEvent> {
    const account = input.account ?? this.defaultAccount();
    const { calendarId, eventId } = this.splitCompositeId(compositeId);
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body.summary = input.title;
    if (input.description !== undefined) body.description = input.description;
    if (input.start !== undefined) body.start = { dateTime: input.start };
    if (input.end !== undefined) body.end = { dateTime: input.end };

    const data = (await this.googleFetch(
      `${CALENDAR_EVENTS_API}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      account,
      { method: "PATCH", body: JSON.stringify(body) }
    )) as GCalEventDetail;
    return {
      id: compositeId,
      title: data.summary ?? "(sem titulo)",
      start: data.start?.dateTime ?? data.start?.date ?? new Date().toISOString(),
      end: data.end?.dateTime ?? data.end?.date,
      location: data.location,
      account,
      calendarName: calendarId,
    };
  }

  async remove(compositeId: string, account?: string): Promise<void> {
    const acc = account ?? this.defaultAccount();
    const { calendarId, eventId } = this.splitCompositeId(compositeId);
    await this.googleFetch(
      `${CALENDAR_EVENTS_API}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      acc,
      { method: "DELETE" }
    );
  }
}
