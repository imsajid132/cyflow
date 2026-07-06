import { z } from "zod";
import type { App, ModuleDef } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { accessToken, compact, gapi, googleTestConnection, withQuery } from "./google-common";

/** Google Calendar connector (production). Auth: Google OAuth2 (Phase B). */

const BASE = "https://www.googleapis.com/calendar/v3";

/** Accept an RFC-3339 datetime string or a { date } all-day value. */
const timeSchema = z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() });

const listCalendars: ModuleDef["run"] = async (_i, _params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Calendar");
  const json = await gapi<{ items?: unknown[]; nextPageToken?: string }>({ method: "GET", url: `${BASE}/users/me/calendarList`, token });
  return [{ calendars: json.items ?? [] } as Bundle];
};

const listEvents: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Calendar");
  const p = params as { calendarId?: string; timeMin?: string; timeMax?: string; maxResults?: number; pageToken?: string; query?: string };
  const cal = p.calendarId || "primary";
  const json = await gapi<{ items?: unknown[]; nextPageToken?: string }>({
    method: "GET",
    url: withQuery(`${BASE}/calendars/${encodeURIComponent(cal)}/events`, {
      timeMin: p.timeMin,
      timeMax: p.timeMax,
      q: p.query,
      maxResults: p.maxResults ?? 50,
      singleEvents: "true",
      orderBy: "startTime",
      pageToken: p.pageToken,
    }),
    token,
  });
  return [{ events: json.items ?? [], nextPageToken: json.nextPageToken } as Bundle];
};

const createEvent: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Calendar");
  const p = params as { calendarId?: string; summary: string; description?: string; location?: string; start: unknown; end: unknown; attendees?: string[] };
  const cal = p.calendarId || "primary";
  const body = compact({
    summary: p.summary,
    description: p.description,
    location: p.location,
    start: p.start,
    end: p.end,
    attendees: Array.isArray(p.attendees) ? p.attendees.map((email) => ({ email })) : undefined,
  });
  const json = await gapi<{ id: string; htmlLink?: string; status?: string }>({ method: "POST", url: `${BASE}/calendars/${encodeURIComponent(cal)}/events`, token, body });
  return [{ id: json.id, htmlLink: json.htmlLink, status: json.status } as Bundle];
};

const updateEvent: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Calendar");
  const p = params as { calendarId?: string; eventId: string; summary?: string; description?: string; location?: string; start?: unknown; end?: unknown };
  const cal = p.calendarId || "primary";
  const body = compact({ summary: p.summary, description: p.description, location: p.location, start: p.start, end: p.end });
  const json = await gapi<{ id: string; htmlLink?: string }>({ method: "PATCH", url: `${BASE}/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(p.eventId)}`, token, body });
  return [{ id: json.id, htmlLink: json.htmlLink } as Bundle];
};

const deleteEvent: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Calendar");
  const p = params as { calendarId?: string; eventId: string };
  const cal = p.calendarId || "primary";
  await gapi({ method: "DELETE", url: `${BASE}/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(p.eventId)}`, token });
  return [{ deleted: true, eventId: p.eventId } as Bundle];
};

export const calendarApp: App = {
  key: "calendar",
  name: "Google Calendar",
  auth: { type: "oauth2" },
  modules: {
    list_calendars: { key: "list_calendars", name: "List calendars", kind: "search", params: z.object({}), run: listCalendars },
    list_events: { key: "list_events", name: "List events", kind: "search", params: z.object({ calendarId: z.string().optional(), timeMin: z.string().optional(), timeMax: z.string().optional(), query: z.string().optional(), maxResults: z.number().optional(), pageToken: z.string().optional() }), run: listEvents },
    create_event: { key: "create_event", name: "Create an event", kind: "action", params: z.object({ calendarId: z.string().optional(), summary: z.string(), description: z.string().optional(), location: z.string().optional(), start: timeSchema, end: timeSchema, attendees: z.array(z.string()).optional() }), run: createEvent },
    update_event: { key: "update_event", name: "Update an event", kind: "action", params: z.object({ calendarId: z.string().optional(), eventId: z.string(), summary: z.string().optional(), description: z.string().optional(), location: z.string().optional(), start: timeSchema.optional(), end: timeSchema.optional() }), run: updateEvent },
    delete_event: { key: "delete_event", name: "Delete an event", kind: "action", params: z.object({ calendarId: z.string().optional(), eventId: z.string() }), run: deleteEvent },
  },
  testConnection: googleTestConnection,
};
