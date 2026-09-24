/**
 * Meetings Domain Service.
 * Provides functions to list, inspect, and deep-search OpenProject meetings and agenda items.
 */

import type { OpenProjectClient } from "../client/api-client.ts";
import { extractIdFromHref, extractRawText } from "../client/hal-parser.ts";
import type { HalCollection, HalResource } from "../client/types.ts";
import { resolveClient, resolveProjectId } from "./helper.ts";
import { isFatalSearchError, searchPipeline } from "../search/pipeline.ts";
import { rankRecords } from "../search/rank.ts";
import type { FieldSpec, MatchMode } from "../search/rank.ts";

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
  matchType: "title" | "location" | "agenda_item" | "participant" | "author" | "project";
  matchedAgendaItems?: Array<{
    id: number;
    title: string;
    snippet?: string;
  }>;
  /** Relevance score in the range 0..1. */
  score: number;
  /** Names of the fields that matched, highest scoring first. */
  matchedFields: string[];
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
 * Search results are exposed under `elements` only. `items` is deliberately
 * omitted: the tool layer JSON-stringifies this whole object, so carrying the
 * same array twice doubles the token cost of every search response.
 */
export interface MeetingSearchPage
  extends Omit<PaginatedResult<MeetingSearchResult>, "items"> {
  elements: MeetingSearchResult[];
  /** True when some deep content could not be read. */
  degraded: boolean;
  enrichmentFailures: number;
}

export interface SearchMeetingsParams {
  query: string;
  projectId?: string | number;
  offset?: number;
  pageSize?: number;
  matchMode?: MatchMode;
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
        .catch((error: unknown) => {
          // An expired token or a rate limit must not be reported to the
          // model as "this meeting has no agenda items". Degrade only on
          // errors that genuinely mean "agenda unavailable" (404, 500, ...).
          if (isFatalSearchError(error)) {
            throw error;
          }
          return undefined;
        }),
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

interface MeetingDeepContent {
  id: number;
  agendaItems: AgendaItem[];
  participants: Array<{ id: number; name: string }>;
}

/**
 * Fetches agenda items and participants for one meeting.
 */
async function fetchMeetingDeepContent(
  meetingId: number,
  client: OpenProjectClient
): Promise<MeetingDeepContent> {
  const [agendaResponse, detail] = await Promise.all([
    client.get<HalCollection<Record<string, unknown>>>(
      `/api/v3/meetings/${meetingId}/agenda_items`
    ),
    client.get<HalResource>(`/api/v3/meetings/${meetingId}`),
  ]);

  const rawItems = agendaResponse?._embedded?.elements ?? [];
  const meetingDetail = normalizeMeetingDetail(detail);

  return {
    id: meetingId,
    agendaItems: rawItems.map(normalizeAgendaItem),
    participants: meetingDetail.participants,
  };
}

/**
 * Maps matched field names onto the legacy matchType discriminator, in
 * priority order.
 */
function resolveMatchType(matchedFields: string[]): MeetingSearchResult["matchType"] {
  if (matchedFields.includes("title")) return "title";
  if (matchedFields.includes("location")) return "location";
  if (
    matchedFields.includes("agenda_item") ||
    matchedFields.includes("agenda_notes") ||
    matchedFields.includes("outcome_notes")
  ) {
    return "agenda_item";
  }
  if (matchedFields.includes("participant")) return "participant";
  // `author` sits below `participant` and above the `project` fallback: both
  // are person matches, and author carries the lower field weight. Without
  // this branch an author-only hit falls through and is reported to the model
  // as a project-name match.
  if (matchedFields.includes("author")) return "author";
  return "project";
}

/**
 * Ranks a meeting's agenda items against the query directly.
 *
 * Do NOT try to work out which item matched by searching the meeting-level
 * snippet: snippets are trimmed and ellipsized, so the original text is not
 * recoverable from them. Ranking the items themselves gives exact per-item
 * scores and snippets for free.
 */
function collectMatchedAgendaItems(
  deep: MeetingDeepContent | undefined,
  query: string,
  matchMode: MatchMode
): Array<{ id: number; title: string; snippet?: string }> {
  if (!deep || deep.agendaItems.length === 0) {
    return [];
  }

  const fields: FieldSpec<AgendaItem>[] = [
    { name: "title", weight: 2, extract: (item) => item.title },
    { name: "notes", weight: 1.5, extract: (item) => item.notes },
    {
      name: "outcomes",
      weight: 1.5,
      extract: (item) => item.outcomes.map((outcome) => outcome.notes),
    },
  ];

  return rankRecords(deep.agendaItems, query, fields, { matchMode }).map((entry) => ({
    id: entry.record.id,
    title: entry.record.title,
    snippet: entry.matches[0]?.snippet,
  }));
}

/**
 * Deep searches meetings across titles, locations, agenda items,
 * participants, and project names using fuzzy matching.
 */
export async function searchMeetings(
  params: SearchMeetingsParams,
  client?: OpenProjectClient
): Promise<MeetingSearchPage> {
  const opClient = resolveClient(client);
  const matchMode = params.matchMode ?? "fuzzy";

  const MAX_CANDIDATES = 250;
  const CANDIDATE_BATCH_SIZE = 100;

  const fetchCandidates = async (): Promise<MeetingSummary[]> => {
    const collected: MeetingSummary[] = [];
    let offset = 1;

    while (collected.length < MAX_CANDIDATES) {
      const page = await listMeetings(
        { projectId: params.projectId, offset, pageSize: CANDIDATE_BATCH_SIZE },
        opClient
      );

      if (page.elements.length === 0) {
        break;
      }
      collected.push(...page.elements);

      if (collected.length >= page.total || page.elements.length < CANDIDATE_BATCH_SIZE) {
        break;
      }
      offset += 1;
    }

    return collected.slice(0, MAX_CANDIDATES);
  };

  const shallowFields: FieldSpec<MeetingSummary>[] = [
    { name: "title", weight: 3, extract: (m) => m.title },
    { name: "location", weight: 1, extract: (m) => m.location },
    { name: "project", weight: 0.5, extract: (m) => m.project.name },
    { name: "author", weight: 0.5, extract: (m) => m.author?.name },
  ];

  const deepFields: FieldSpec<MeetingDeepContent>[] = [
    { name: "agenda_item", weight: 2, extract: (d) => d.agendaItems.map((i) => i.title) },
    {
      name: "agenda_notes",
      weight: 1.5,
      extract: (d) => d.agendaItems.map((i) => i.notes ?? "").filter((n) => n.length > 0),
    },
    {
      name: "outcome_notes",
      weight: 1.5,
      extract: (d) => d.agendaItems.flatMap((i) => i.outcomes.map((o) => o.notes)),
    },
    { name: "participant", weight: 1, extract: (d) => d.participants.map((p) => p.name) },
  ];

  const result = await searchPipeline<MeetingSummary, MeetingDeepContent>(
    {
      fetchCandidates,
      shallowFields,
      enrich: (meeting) => fetchMeetingDeepContent(meeting.id, opClient),
      deepFields,
      recencyOf: (meeting) => meeting.startTime,
      idOf: (meeting) => meeting.id,
    },
    params.query,
    { matchMode }
  );

  const all: MeetingSearchResult[] = result.ranked.map((entry) => {
    const matchedFields = entry.matches.map((match) => match.field);
    const matchedAgendaItems = collectMatchedAgendaItems(entry.deep, params.query, matchMode);

    return {
      meeting: entry.record,
      matchType: resolveMatchType(matchedFields),
      matchedAgendaItems: matchedAgendaItems.length > 0 ? matchedAgendaItems : undefined,
      score: entry.score,
      matchedFields,
    };
  });

  // `offset` is a 1-based PAGE number, as the tool schema documents and as the
  // rest of this codebase and the OpenProject API treat it — not an item index.
  const offset = params.offset ?? 1;
  const pageSize = params.pageSize ?? 20;
  const startIndex = Math.max(0, offset - 1) * pageSize;
  const paged = all.slice(startIndex, startIndex + pageSize);

  return {
    total: all.length,
    count: paged.length,
    pageSize,
    offset,
    elements: paged,
    degraded: result.degraded,
    enrichmentFailures: result.enrichmentFailures,
  };
}
