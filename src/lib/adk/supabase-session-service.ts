import {
  BaseSessionService,
  type AppendEventRequest,
  type CreateSessionRequest,
  type DeleteSessionRequest,
  type Event,
  type GetSessionRequest,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type Session,
} from "@google/adk";
import type { SupabaseClient } from "@supabase/supabase-js";

type SessionRow = {
  id: string;
  app_name: string;
  user_id: string;
  state: Record<string, unknown>;
  updated_at: string;
};

const SESSION_COLUMNS = "id, app_name, user_id, state, updated_at";
const TEMP_PREFIX = "temp:";

function toSession(row: SessionRow, events: Event[]): Session {
  return {
    id: row.id,
    appName: row.app_name,
    userId: row.user_id,
    state: row.state ?? {},
    events,
    lastUpdateTime: new Date(row.updated_at).getTime(),
  };
}

/**
 * ADK session store backed by Supabase. It is constructed per request with the
 * caller's authenticated Supabase client, so every read/write runs under RLS
 * (owner_id = auth.uid()). Events are persisted whole as JSONB.
 *
 * `app:` / `user:` prefixed state keys are kept in the session state as-is
 * (no cross-session app/user state tables in this MVP).
 */
export class SupabaseSessionService extends BaseSessionService {
  constructor(private readonly supabase: SupabaseClient) {
    super();
  }

  async createSession({ appName, userId, state, sessionId }: CreateSessionRequest): Promise<Session> {
    const initialState = Object.fromEntries(
      Object.entries(state ?? {}).filter(([key]) => !key.startsWith(TEMP_PREFIX)),
    );
    const { data, error } = await this.supabase
      .from("adk_sessions")
      .insert({ id: sessionId ?? crypto.randomUUID(), app_name: appName, user_id: userId, state: initialState })
      .select(SESSION_COLUMNS)
      .single<SessionRow>();
    if (error) throw new Error(`createSession failed: ${error.message}`);
    return toSession(data, []);
  }

  async getSession({ appName, userId, sessionId, config }: GetSessionRequest): Promise<Session | undefined> {
    const { data: row, error } = await this.supabase
      .from("adk_sessions")
      .select(SESSION_COLUMNS)
      .eq("id", sessionId)
      .eq("app_name", appName)
      .eq("user_id", userId)
      .maybeSingle<SessionRow>();
    if (error) throw new Error(`getSession failed: ${error.message}`);
    if (!row) return undefined;

    const { data: eventRows, error: eventsError } = await this.supabase
      .from("adk_events")
      .select("event_json")
      .eq("session_id", sessionId)
      .order("sequence_no", { ascending: true })
      .returns<{ event_json: Event }[]>();
    if (eventsError) throw new Error(`getSession events failed: ${eventsError.message}`);

    let events = (eventRows ?? []).map((r) => r.event_json);
    if (config?.afterTimestamp) events = events.filter((e) => e.timestamp > config.afterTimestamp!);
    if (config?.numRecentEvents) events = events.slice(-config.numRecentEvents);
    return toSession(row, events);
  }

  async listSessions({ appName, userId, limit = 20, page = 1, order = "desc" }: ListSessionsRequest): Promise<ListSessionsResponse> {
    let query = this.supabase
      .from("adk_sessions")
      .select(SESSION_COLUMNS, { count: "exact" })
      .eq("app_name", appName)
      .order("updated_at", { ascending: order === "asc" })
      .range((page - 1) * limit, page * limit - 1);
    if (userId) query = query.eq("user_id", userId);
    const { data, error, count } = await query.returns<SessionRow[]>();
    if (error) throw new Error(`listSessions failed: ${error.message}`);
    const totalItems = count ?? 0;
    return {
      sessions: (data ?? []).map((row) => toSession(row, [])),
      page,
      limit,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
    };
  }

  async deleteSession({ appName, userId, sessionId }: DeleteSessionRequest): Promise<void> {
    const { error } = await this.supabase
      .from("adk_sessions")
      .delete()
      .eq("id", sessionId)
      .eq("app_name", appName)
      .eq("user_id", userId);
    if (error) throw new Error(`deleteSession failed: ${error.message}`);
  }

  async appendEvent({ session, event }: AppendEventRequest): Promise<Event> {
    if (event.partial) return event;
    // Base implementation trims temp: state keys and updates the in-memory session.
    const appended = await super.appendEvent({ session, event });
    const { error } = await this.supabase.rpc("adk_append_event", {
      p_session_id: session.id,
      p_event_id: appended.id,
      p_event: JSON.parse(JSON.stringify(appended)),
      p_state_delta: appended.actions?.stateDelta ?? {},
    });
    if (error) throw new Error(`appendEvent failed: ${error.message}`);
    session.lastUpdateTime = appended.timestamp;
    return appended;
  }
}
