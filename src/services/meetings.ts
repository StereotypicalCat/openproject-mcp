/**
 * Meetings Domain Service.
 * Provides functions to list, inspect, and deep-search OpenProject meetings and agenda items.
 */

import type { OpenProjectClient } from "../client/api-client.ts";
import { extractIdFromHref, extractRawText } from "../client/hal-parser.ts";
import type { HalCollection, HalResource } from "../client/types.ts";
import { resolveClient, resolveProjectId } from "./helper.ts";

export interface MeetingSummary {
  id: number;
  title: string;
  state: string;
  startTime: string;
  endTime: string;
  duration?: string;
  project: { id: number; name: string };
  location?: string;
  author?: { id: number; name: string };
}

export interface AgendaItemOutcome {
  id: number;
  notes: string;
}

export interface AgendaItem {
  id: number;
  title: string;
  durationInMinutes?: number;
  notes?: string;
  itemType: string;
  position: number;
  author?: { id: number; name: string };
  presenter?: { id: number; name: string };
  section?: { id: number; title: string };
  outcomes: AgendaItemOutcome[];
}

export interface MeetingDetail extends MeetingSummary {
  template: boolean;
  notify: boolean;
  participants: Array<{ id: number; name: string }>;
  agendaItems?: AgendaItem[];
  sections?: Array<{ id: number; title: string; position: number }>;
}

export interface MeetingSearchResult {
  meeting: MeetingSummary;
  matchType: "title" | "location" | "agenda_item";
  matchedAgendaItems?: Array<{
    id: number;
    title: string;
    snippet?: string;
  }>;
}

export interface PaginatedResult<T> {
  total: number;
  count: number;
  pageSize: number;
  offset: number;
  elements: T[];
  items?: T[];
}

/**
 * Normalizes a raw HAL Meeting resource into a token-efficient MeetingSummary.
 */
export function normalizeMeetingSummary(resource: HalResource): MeetingSummary {
  const links = (resource._links ?? {}) as Record<string, { href?: string; title?: string } | undefined>;
  const selfLink = links.self;
  const projectLink = links.project;
  const authorLink = links.author;

  const embedded = (resource._embedded ?? {}) as Record<string, unknown>;
  const embeddedProject = embedded.project as { id?: number; name?: string } | undefined;
  const embeddedAuthor = embedded.author as { id?: number; name?: string } | undefined;

  const id = resource.id ?? extractIdFromHref(selfLink?.href) ?? 0;
  const title = String(resource.title ?? "");
  const state = String(resource.state ?? "");
  const startTime = String(resource.startTime ?? "");
  const endTime = String(resource.endTime ?? "");
  const duration = resource.duration ? String(resource.duration) : undefined;
  const location = resource.location ? String(resource.location) : undefined;

  const projectId = extractIdFromHref(projectLink?.href) ?? embeddedProject?.id ?? 0;
  const projectName = projectLink?.title ?? embeddedProject?.name ?? "";

  let author: { id: number; name: string } | undefined;
  const authorId = extractIdFromHref(authorLink?.href) ?? embeddedAuthor?.id;
  const authorName = authorLink?.title ?? embeddedAuthor?.name;
  if (authorId !== undefined || authorName !== undefined) {
    author = {
      id: authorId ?? 0,
      name: authorName ?? (authorId ? `User #${authorId}` : ""),
    };
  }

  return {
    id,
    title,
    state,
    startTime,
    endTime,
    duration,
    project: { id: projectId, name: projectName },
    location,
    author,
  };
}

/**
 * Normalizes an Agenda Item Outcome.
 */
export function normalizeOutcome(outcome: Record<string, unknown>): AgendaItemOutcome {
  const links = (outcome._links ?? {}) as Record<string, { href?: string } | undefined>;
  const id = (typeof outcome.id === "number" ? outcome.id : extractIdFromHref(links.self?.href)) ?? 0;
  const notes = extractRawText(outcome.notes ?? outcome.text ?? outcome.comment ?? "");
  return { id, notes };
}

/**
 * Normalizes a raw HAL Agenda Item resource into an AgendaItem.
 */
export function normalizeAgendaItem(item: Record<string, unknown>): AgendaItem {
  const links = (item._links ?? {}) as Record<string, { href?: string; title?: string } | undefined>;
  const embedded = (item._embedded ?? {}) as Record<string, unknown>;

  const id = (typeof item.id === "number" ? item.id : extractIdFromHref(links.self?.href)) ?? 0;
  const title = String(item.title ?? links.workPackage?.title ?? "");
  const itemType = String(item.itemType ?? item.type ?? "simple");
  const position = typeof item.position === "number" ? item.position : 0;
  const durationInMinutes =
    typeof item.durationInMinutes === "number" ? item.durationInMinutes : undefined;
  const rawNotes = extractRawText(item.notes);
  const notes = rawNotes.length > 0 ? rawNotes : undefined;

  let author: { id: number; name: string } | undefined;
  const authorLink = links.author;
  const authorId = extractIdFromHref(authorLink?.href);
  if (authorId !== undefined || authorLink?.title) {
    author = {
      id: authorId ?? 0,
      name: authorLink?.title ?? `User #${authorId}`,
    };
  }

  let presenter: { id: number; name: string } | undefined;
  const presenterLink = links.presenter;
  const presenterId = extractIdFromHref(presenterLink?.href);
  if (presenterId !== undefined || presenterLink?.title) {
    presenter = {
      id: presenterId ?? 0,
      name: presenterLink?.title ?? `User #${presenterId}`,
    };
  }

  let section: { id: number; title: string } | undefined;
  const sectionObj = (embedded.section ?? links.section) as
    | { id?: number; title?: string; href?: string; _links?: { self?: { href?: string } } }
    | undefined;
  if (sectionObj) {
    const sectionId =
      sectionObj.id ?? extractIdFromHref(sectionObj.href ?? sectionObj._links?.self?.href);
    if (sectionId !== undefined || sectionObj.title !== undefined) {
      section = {
        id: sectionId ?? 0,
        title: sectionObj.title ?? "",
      };
    }
  }

  const rawOutcomes = embedded.outcomes ?? links.outcomes ?? [];
  const outcomes: AgendaItemOutcome[] = Array.isArray(rawOutcomes)
    ? rawOutcomes.map((o) => normalizeOutcome(o as Record<string, unknown>))
    : [];

  return {
    id,
    title,
    durationInMinutes,
    notes,
    itemType,
    position,
    author,
    presenter,
    section,
    outcomes,
  };
}

/**
 * Normalizes a raw HAL Meeting resource and embedded agenda items into a MeetingDetail.
 */
export function normalizeMeetingDetail(
  resource: HalResource,
  agendaItems?: AgendaItem[]
): MeetingDetail {
  const summary = normalizeMeetingSummary(resource);
  const links = (resource._links ?? {}) as Record<string, unknown>;
  const embedded = (resource._embedded ?? {}) as Record<string, unknown>;

  const template = Boolean(resource.template);
  const notify = Boolean(resource.notify);

  const rawParticipants = embedded.participants ?? links.participants ?? [];
  const participants: Array<{ id: number; name: string }> = [];
  if (Array.isArray(rawParticipants)) {
    for (const p of rawParticipants) {
      const pObj = p as { id?: number; href?: string; title?: string; name?: string; _links?: { self?: { href?: string } } };
      const pId = pObj.id ?? extractIdFromHref(pObj.href ?? pObj._links?.self?.href);
      const pName = pObj.title ?? pObj.name;
      if (pId !== undefined || pName !== undefined) {
        participants.push({
          id: pId ?? 0,
          name: pName ?? (pId ? `User #${pId}` : ""),
        });
      }
    }
  }

  const rawSections = embedded.sections ?? links.sections ?? [];
  let sections: Array<{ id: number; title: string; position: number }> | undefined;
  if (Array.isArray(rawSections) && rawSections.length > 0) {
    sections = (rawSections as Array<{ id?: number; href?: string; title?: string; position?: number; _links?: { self?: { href?: string } } }>).map(
      (s) => ({
        id: s.id ?? extractIdFromHref(s.href ?? s._links?.self?.href) ?? 0,
        title: s.title ?? "",
        position: typeof s.position === "number" ? s.position : 0,
      })
    );
  }

  return {
    ...summary,
    template,
    notify,
    participants,
    agendaItems,
    sections,
  };
}

/**
 * Extracts a concise text snippet centered around query match keyword.
 */
function extractSnippet(text: string, query: string, maxLength = 160): string {
  if (!text) return "";
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) {
    return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
  }
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 80);
  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = `...${snippet}`;
  if (end < text.length) snippet = `${snippet}...`;
  return snippet;
}

/**
 * Lists meetings visible to the user matching optional project, time, and pagination filters.
 */
export async function listMeetings(
  params?: {
    projectId?: string | number;
    time?: string;
    offset?: number;
    pageSize?: number;
  },
  client?: OpenProjectClient
): Promise<PaginatedResult<MeetingSummary>> {
  const opClient = resolveClient(client);

  const filters: Record<string, { operator: string; values: string[] }>[] = [];

  if (params?.projectId !== undefined) {
    const resolvedId = await resolveProjectId(params.projectId, opClient);
    filters.push({
      project_id: {
        operator: "=",
        values: [String(resolvedId)],
      },
    });
  }

  if (params?.time) {
    const timeLower = params.time.toLowerCase().trim();
    const operator = timeLower === "past" ? "past" : "upcoming";
    filters.push({
      time: {
        operator,
        values: [],
      },
    });
  }

  const searchParams = new URLSearchParams();
  if (params?.pageSize !== undefined) {
    searchParams.set("pageSize", String(params.pageSize));
  }
  if (params?.offset !== undefined) {
    searchParams.set("offset", String(params.offset));
  }
  if (filters.length > 0) {
    searchParams.set("filters", JSON.stringify(filters));
  }

  const queryStr = searchParams.toString();
  const path = `/api/v3/meetings${queryStr ? `?${queryStr}` : ""}`;

  const response = await opClient.get<HalCollection<HalResource>>(path);
  const rawElements = response._embedded?.elements ?? [];
  const elements = rawElements.map(normalizeMeetingSummary);

  return {
    total: response.total ?? elements.length,
    count: response.count ?? elements.length,
    pageSize: response.pageSize ?? elements.length,
    offset: response.offset ?? 1,
    elements,
    items: elements,
  };
}

/**
 * Retrieves a single meeting by ID, optionally including its agenda items.
 */
export async function getMeeting(
  id: number,
  options?: { includeAgendaItems?: boolean },
  client?: OpenProjectClient
): Promise<MeetingDetail> {
  const opClient = resolveClient(client);
  const includeAgenda = options?.includeAgendaItems ?? true;

  const meetingPromise = opClient.get<HalResource>(`/api/v3/meetings/${id}`);

  if (includeAgenda) {
    const [meetingResource, agendaResponse] = await Promise.all([
      meetingPromise,
      opClient
        .get<HalCollection<Record<string, unknown>>>(`/api/v3/meetings/${id}/agenda_items`)
        .catch(() => undefined),
    ]);

    let agendaItems: AgendaItem[] | undefined;
    if (agendaResponse?._embedded?.elements) {
      agendaItems = agendaResponse._embedded.elements.map(normalizeAgendaItem);
    } else {
      agendaItems = [];
    }

    return normalizeMeetingDetail(meetingResource, agendaItems);
  }

  const meetingResource = await meetingPromise;
  return normalizeMeetingDetail(meetingResource);
}

/**
 * Deep searches across meetings by title, location, and agenda item notes.
 */
export async function searchMeetings(
  params: {
    query: string;
    projectId?: string | number;
    offset?: number;
    pageSize?: number;
  },
  client?: OpenProjectClient
): Promise<PaginatedResult<MeetingSearchResult>> {
  const opClient = resolveClient(client);
  const needle = params.query.toLowerCase().trim();

  // Fetch candidate meetings scoped to project if specified
  const candidateBatchSize = Math.max(params.pageSize ?? 50, 50);
  const meetingsResult = await listMeetings(
    {
      projectId: params.projectId,
      offset: 1,
      pageSize: candidateBatchSize,
    },
    opClient
  );

  const candidateMeetings = meetingsResult.elements;

  // Process candidate meetings concurrently
  const matchPromises = candidateMeetings.map(async (meeting) => {
    const titleMatches = meeting.title.toLowerCase().includes(needle);
    const locationMatches = Boolean(
      meeting.location && meeting.location.toLowerCase().includes(needle)
    );

    // Concurrently fetch agenda items for candidate meeting
    const agendaResponse = await opClient
      .get<HalCollection<Record<string, unknown>>>(`/api/v3/meetings/${meeting.id}/agenda_items`)
      .catch(() => undefined);

    const rawItems = agendaResponse?._embedded?.elements ?? [];
    const agendaItems = rawItems.map(normalizeAgendaItem);

    const matchedAgendaItems: Array<{ id: number; title: string; snippet?: string }> = [];
    for (const item of agendaItems) {
      const itemTitleMatches = item.title.toLowerCase().includes(needle);
      const itemNotesMatches = Boolean(item.notes && item.notes.toLowerCase().includes(needle));
      const outcomeNotesMatch = item.outcomes.find((o) =>
        o.notes.toLowerCase().includes(needle)
      );

      if (itemTitleMatches || itemNotesMatches || outcomeNotesMatch) {
        let snippetText = "";
        if (itemNotesMatches && item.notes) {
          snippetText = extractSnippet(item.notes, params.query);
        } else if (outcomeNotesMatch) {
          snippetText = extractSnippet(outcomeNotesMatch.notes, params.query);
        } else {
          snippetText = item.notes ? extractSnippet(item.notes, params.query) : item.title;
        }

        matchedAgendaItems.push({
          id: item.id,
          title: item.title,
          snippet: snippetText || undefined,
        });
      }
    }

    let matchType: "title" | "location" | "agenda_item" | null = null;
    if (titleMatches) {
      matchType = "title";
    } else if (locationMatches) {
      matchType = "location";
    } else if (matchedAgendaItems.length > 0) {
      matchType = "agenda_item";
    }

    if (!matchType) {
      return null;
    }

    const searchResult: MeetingSearchResult = {
      meeting,
      matchType,
      matchedAgendaItems: matchedAgendaItems.length > 0 ? matchedAgendaItems : undefined,
    };

    return searchResult;
  });

  const resolvedMatches = await Promise.all(matchPromises);
  const matchedElements: MeetingSearchResult[] = resolvedMatches.filter(
    (item): item is MeetingSearchResult => item !== null
  );

  const total = matchedElements.length;
  const offset = params.offset ?? 1;
  const requestedPageSize = params.pageSize ?? 20;
  const startIndex = Math.max(0, offset - 1);
  const pagedElements = matchedElements.slice(startIndex, startIndex + requestedPageSize);

  return {
    total,
    count: pagedElements.length,
    pageSize: requestedPageSize,
    offset,
    elements: pagedElements,
    items: pagedElements,
  };
}
