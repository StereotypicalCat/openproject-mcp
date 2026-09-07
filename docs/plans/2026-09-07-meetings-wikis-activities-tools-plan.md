# Meetings, Wikis, and Work Package Activities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the OpenProject MCP server with 7 new read-only tools covering Meetings (listing, inspection, and deep search), Wikis (page retrieval, smart discovery search, and links), and Work Package Activities (history and comments filtering).

**Architecture:** Implement domain services in `src/services/meetings.ts`, `src/services/wikis.ts`, and `src/services/work-packages.ts`. Implement corresponding MCP tool modules in `src/tools/meetings.ts`, `src/tools/wikis.ts`, and `src/tools/work-packages.ts`. Register all tools into `src/tools/index.ts` and `src/services/index.ts`, expanding total tools from 11 to 18. All tools are strictly `readOnly: true`.

**Tech Stack:** Bun (v1.3+), TypeScript (strict mode), `@modelcontextprotocol/sdk`, `zod`, native `fetch`, `bun:test`.

**Spec:** [docs/specs/2026-09-07-meetings-wikis-activities-tools-design.md](../specs/2026-09-07-meetings-wikis-activities-tools-design.md)

## Global Constraints
- Target runtime is Bun (>= 1.2/1.3). Commands use `bun test` and `bun run`.
- No external HTTP libraries; use native `fetch` via `OpenProjectClient`.
- Tool handlers and domain services must retrieve client via ambient `resolveClient(client)`.
- All 7 new tools are marked `readOnly: true` and must remain registered in read-only mode.
- Output JSON must be clean and token-efficient for LLM consumption.

---

### Task 1: Domain Service: Work Package Activities & Comments

**Files:**
- Modify: `src/services/work-packages.ts`
- Test: `tests/work-package-activities.test.ts`

**Interfaces:**
- Consumes: `resolveClient` from `src/services/helper.ts`, `OpenProjectClient` from `src/client/api-client.ts`.
- Produces:
  ```typescript
  export interface ActivityDetail {
    format: string;
    raw: string;
    html?: string;
  }

  export interface WorkPackageActivity {
    id: number;
    version: number;
    createdAt: string;
    user?: { id: number; name: string };
    comment?: string;
    details: ActivityDetail[];
    isComment: boolean;
  }

  export interface ListWorkPackageActivitiesOptions {
    workPackageId: number;
    onlyComments?: boolean;
  }

  export async function listWorkPackageActivities(
    options: ListWorkPackageActivitiesOptions,
    client?: OpenProjectClient
  ): Promise<WorkPackageActivity[]>;
  ```

- [ ] **Step 1: Write failing unit tests for `listWorkPackageActivities`**

```typescript
// tests/work-package-activities.test.ts
import { describe, expect, test } from "bun:test";
import { OpenProjectClient } from "../src/client/api-client.ts";
import { listWorkPackageActivities } from "../src/services/work-packages.ts";

describe("Work Package Activities Service", () => {
  test("parses activities and separates comments from field changes", async () => {
    const mockClient = {
      get: async (path: string) => {
        expect(path).toBe("/api/v3/work_packages/38/activities");
        return {
          _type: "Collection",
          total: 2,
          count: 2,
          _embedded: {
            elements: [
              {
                _type: "Activity",
                id: 60,
                version: 1,
                createdAt: "2026-09-05T14:24:56Z",
                comment: { raw: "", html: "" },
                details: [
                  { format: "custom", raw: "Status set to In progress" }
                ],
                _links: {
                  user: { href: "/api/v3/users/2", title: "Admin User" }
                }
              },
              {
                _type: "Activity",
                id: 61,
                version: 2,
                createdAt: "2026-09-05T15:00:00Z",
                comment: { raw: "Fixed in commit abc1234", html: "<p>Fixed</p>" },
                details: [],
                _links: {
                  user: { href: "/api/v3/users/3", title: "Dev User" }
                }
              }
            ]
          }
        };
      }
    } as unknown as OpenProjectClient;

    const all = await listWorkPackageActivities({ workPackageId: 38 }, mockClient);
    expect(all).toHaveLength(2);
    expect(all[0].isComment).toBe(false);
    expect(all[1].isComment).toBe(true);
    expect(all[1].comment).toBe("Fixed in commit abc1234");
    expect(all[1].user?.name).toBe("Dev User");

    const commentsOnly = await listWorkPackageActivities({ workPackageId: 38, onlyComments: true }, mockClient);
    expect(commentsOnly).toHaveLength(1);
    expect(commentsOnly[0].id).toBe(61);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/work-package-activities.test.ts`
Expected: FAIL (`listWorkPackageActivities` is not exported from `src/services/work-packages.ts`).

- [ ] **Step 3: Implement `listWorkPackageActivities` in `src/services/work-packages.ts`**

Add interfaces and `listWorkPackageActivities`:
```typescript
export interface ActivityDetail {
  format: string;
  raw: string;
  html?: string;
}

export interface WorkPackageActivity {
  id: number;
  version: number;
  createdAt: string;
  user?: { id: number; name: string };
  comment?: string;
  details: ActivityDetail[];
  isComment: boolean;
}

export interface ListWorkPackageActivitiesOptions {
  workPackageId: number;
  onlyComments?: boolean;
}

export async function listWorkPackageActivities(
  options: ListWorkPackageActivitiesOptions,
  client?: OpenProjectClient
): Promise<WorkPackageActivity[]> {
  const opClient = resolveClient(client);
  const response = await opClient.get<Record<string, unknown>>(
    `/api/v3/work_packages/${options.workPackageId}/activities`
  );

  const elements = (response._embedded as { elements?: unknown[] })?.elements ?? [];
  const activities: WorkPackageActivity[] = [];

  for (const item of elements) {
    const rawItem = item as Record<string, unknown>;
    const commentObj = rawItem.comment as { raw?: string } | undefined;
    const commentRaw = typeof commentObj?.raw === "string" ? commentObj.raw.trim() : "";
    const isComment = commentRaw.length > 0;

    if (options.onlyComments && !isComment) {
      continue;
    }

    const links = (rawItem._links as Record<string, { href?: string; title?: string }>) ?? {};
    const userLink = links.user;
    let user: { id: number; name: string } | undefined;
    if (userLink?.href) {
      const match = userLink.href.match(/\/users\/(\d+)/);
      if (match) {
        user = {
          id: Number(match[1]),
          name: userLink.title ?? `User #${match[1]}`
        };
      }
    }

    const rawDetails = (rawItem.details as Array<{ format?: string; raw?: string; html?: string }>) ?? [];
    const details: ActivityDetail[] = rawDetails.map((d) => ({
      format: d.format ?? "custom",
      raw: d.raw ?? "",
      html: d.html
    }));

    activities.push({
      id: Number(rawItem.id),
      version: Number(rawItem.version ?? 1),
      createdAt: String(rawItem.createdAt ?? ""),
      user,
      comment: commentRaw || undefined,
      details,
      isComment
    });
  }

  return activities;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/work-package-activities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/work-packages.ts tests/work-package-activities.test.ts
git commit -m "feat: add listWorkPackageActivities domain service"
```

---

### Task 2: Domain Service: Meetings

**Files:**
- Create: `src/services/meetings.ts`
- Test: `tests/meetings.test.ts`

**Interfaces:**
- Consumes: `resolveClient`, `resolveProjectId` from `src/services/helper.ts`, `OpenProjectClient` from `src/client/api-client.ts`.
- Produces:
  ```typescript
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

  export async function listMeetings(
    params?: { projectId?: string | number; time?: string; offset?: number; pageSize?: number },
    client?: OpenProjectClient
  ): Promise<PaginatedResult<MeetingSummary>>;

  export async function getMeeting(
    id: number,
    options?: { includeAgendaItems?: boolean },
    client?: OpenProjectClient
  ): Promise<MeetingDetail>;

  export async function searchMeetings(
    params: { query: string; projectId?: string | number; offset?: number; pageSize?: number },
    client?: OpenProjectClient
  ): Promise<PaginatedResult<MeetingSearchResult>>;
  ```

- [ ] **Step 1: Write failing tests for Meetings service**

```typescript
// tests/meetings.test.ts
import { describe, expect, test } from "bun:test";
import { OpenProjectClient } from "../src/client/api-client.ts";
import { listMeetings, getMeeting, searchMeetings } from "../src/services/meetings.ts";

describe("Meetings Service", () => {
  test("listMeetings serializes project filter and parses meeting items", async () => {
    const mockClient = {
      get: async (path: string) => {
        expect(path).toContain("/api/v3/meetings");
        return {
          _type: "Collection",
          total: 1,
          count: 1,
          pageSize: 20,
          offset: 1,
          _embedded: {
            elements: [
              {
                _type: "Meeting",
                id: 2,
                title: "Weekly Planning",
                state: "open",
                startTime: "2026-09-08T00:22:53Z",
                endTime: "2026-09-08T01:22:53Z",
                duration: "PT1H",
                _links: {
                  project: { href: "/api/v3/projects/1", title: "Demo project" },
                  author: { href: "/api/v3/users/4", title: "Admin" }
                }
              }
            ]
          }
        };
      }
    } as unknown as OpenProjectClient;

    const res = await listMeetings({ projectId: 1 }, mockClient);
    expect(res.total).toBe(1);
    expect(res.elements[0].title).toBe("Weekly Planning");
    expect(res.elements[0].project.name).toBe("Demo project");
  });

  test("getMeeting fetches details and embeds agenda items", async () => {
    const mockClient = {
      get: async (path: string) => {
        if (path === "/api/v3/meetings/2") {
          return {
            _type: "Meeting",
            id: 2,
            title: "Weekly Planning",
            state: "open",
            startTime: "2026-09-08T00:22:53Z",
            endTime: "2026-09-08T01:22:53Z",
            template: false,
            notify: false,
            _links: {
              project: { href: "/api/v3/projects/1", title: "Demo project" },
              participants: [{ href: "/api/v3/users/4", title: "Admin" }]
            }
          };
        }
        if (path === "/api/v3/meetings/2/agenda_items") {
          return {
            _type: "Collection",
            total: 1,
            _embedded: {
              elements: [
                {
                  _type: "MeetingAgendaItem",
                  id: 10,
                  title: "Good news",
                  position: 1,
                  itemType: "simple",
                  durationInMinutes: 5,
                  notes: { raw: "What went well this week?" },
                  _embedded: { outcomes: [] },
                  _links: { outcomes: [] }
                }
              ]
            }
          };
        }
        throw new Error(`Unexpected path: ${path}`);
      }
    } as unknown as OpenProjectClient;

    const meeting = await getMeeting(2, { includeAgendaItems: true }, mockClient);
    expect(meeting.title).toBe("Weekly Planning");
    expect(meeting.agendaItems).toHaveLength(1);
    expect(meeting.agendaItems![0].title).toBe("Good news");
    expect(meeting.agendaItems![0].notes).toBe("What went well this week?");
  });

  test("searchMeetings finds matches in agenda notes", async () => {
    const mockClient = {
      get: async (path: string) => {
        if (path.startsWith("/api/v3/meetings?")) {
          return {
            _type: "Collection",
            total: 1,
            _embedded: {
              elements: [
                {
                  _type: "Meeting",
                  id: 2,
                  title: "Weekly Planning",
                  state: "open",
                  startTime: "2026-09-08T00:22:53Z",
                  endTime: "2026-09-08T01:22:53Z",
                  _links: {
                    project: { href: "/api/v3/projects/1", title: "Demo project" }
                  }
                }
              ]
            }
          };
        }
        if (path === "/api/v3/meetings/2/agenda_items") {
          return {
            _type: "Collection",
            total: 1,
            _embedded: {
              elements: [
                {
                  _type: "MeetingAgendaItem",
                  id: 10,
                  title: "Sprint Review",
                  notes: { raw: "Discussed critical architecture improvements." }
                }
              ]
            }
          };
        }
        throw new Error(`Unexpected path: ${path}`);
      }
    } as unknown as OpenProjectClient;

    const res = await searchMeetings({ query: "architecture" }, mockClient);
    expect(res.total).toBe(1);
    expect(res.elements[0].matchType).toBe("agenda_item");
    expect(res.elements[0].matchedAgendaItems![0].snippet).toContain("architecture");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/meetings.test.ts`
Expected: FAIL (`src/services/meetings.ts` does not exist).

- [ ] **Step 3: Implement `src/services/meetings.ts`**

Write `src/services/meetings.ts` implementing `listMeetings`, `getMeeting`, and `searchMeetings` with clean helper parsers and ambient client resolution.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/meetings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/meetings.ts tests/meetings.test.ts
git commit -m "feat: add meetings domain service"
```

---

### Task 3: Domain Service: Wikis

**Files:**
- Create: `src/services/wikis.ts`
- Test: `tests/wikis.test.ts`

**Interfaces:**
- Consumes: `resolveClient`, `resolveProjectId` from `src/services/helper.ts`, `OpenProjectClient` from `src/client/api-client.ts`.
- Produces:
  ```typescript
  export interface WikiPageAttachment {
    id: number;
    fileName: string;
    fileSize: number;
    contentType: string;
    downloadUrl: string;
  }

  export interface WikiPageDetail {
    id: number;
    title: string;
    project: { id: number; identifier?: string; name?: string };
    attachments: WikiPageAttachment[];
  }

  export interface WikiPageSummary {
    id: number;
    title: string;
    project: { id: number; identifier?: string; name?: string };
    attachmentsCount: number;
  }

  export interface WikiPageLink {
    id: number;
    pageTitle?: string;
    pageUrl?: string;
    provider?: string;
    workPackage?: { id: number; title?: string };
  }

  export async function getWikiPage(
    id: number,
    client?: OpenProjectClient
  ): Promise<WikiPageDetail>;

  export async function listWikiPageLinks(
    params?: { workPackageId?: number; offset?: number; pageSize?: number },
    client?: OpenProjectClient
  ): Promise<PaginatedResult<WikiPageLink>>;

  export async function searchWikiPages(
    params?: { query?: string; projectId?: string | number; limit?: number },
    client?: OpenProjectClient
  ): Promise<WikiPageSummary[]>;
  ```

- [ ] **Step 1: Write failing tests for Wikis service**

```typescript
// tests/wikis.test.ts
import { describe, expect, test } from "bun:test";
import { OpenProjectClient } from "../src/client/api-client.ts";
import { getWikiPage, listWikiPageLinks, searchWikiPages } from "../src/services/wikis.ts";

describe("Wikis Service", () => {
  test("getWikiPage retrieves page and attaches files", async () => {
    const mockClient = {
      baseUrl: "http://localhost:8080",
      get: async (path: string) => {
        if (path === "/api/v3/wiki_pages/1") {
          return {
            _type: "WikiPage",
            id: 1,
            title: "Project Wiki",
            _links: {
              project: { href: "/api/v3/projects/1", title: "Demo Project" }
            }
          };
        }
        if (path === "/api/v3/wiki_pages/1/attachments") {
          return {
            _type: "Collection",
            total: 1,
            _embedded: {
              elements: [
                {
                  _type: "Attachment",
                  id: 12,
                  fileName: "architecture.png",
                  fileSize: 45000,
                  contentType: "image/png",
                  _links: {
                    downloadLocation: { href: "/api/v3/attachments/12/content" }
                  }
                }
              ]
            }
          };
        }
        throw new Error(`Unexpected path: ${path}`);
      }
    } as unknown as OpenProjectClient;

    const page = await getWikiPage(1, mockClient);
    expect(page.id).toBe(1);
    expect(page.title).toBe("Project Wiki");
    expect(page.project.id).toBe(1);
    expect(page.attachments).toHaveLength(1);
    expect(page.attachments[0].fileName).toBe("architecture.png");
  });

  test("searchWikiPages matches discovered pages by title substring", async () => {
    const mockClient = {
      baseUrl: "http://localhost:8080",
      get: async (path: string) => {
        if (path.startsWith("/api/v3/wiki_page_links")) {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        if (path === "/api/v3/wiki_pages/1") {
          return {
            _type: "WikiPage",
            id: 1,
            title: "System Architecture",
            _links: { project: { href: "/api/v3/projects/1", title: "Demo" } }
          };
        }
        if (path === "/api/v3/wiki_pages/1/attachments") {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        if (path === "/api/v3/wiki_pages/2") {
          return {
            _type: "WikiPage",
            id: 2,
            title: "Sprint Retrospective",
            _links: { project: { href: "/api/v3/projects/1", title: "Demo" } }
          };
        }
        if (path === "/api/v3/wiki_pages/2/attachments") {
          return { _type: "Collection", total: 0, _embedded: { elements: [] } };
        }
        const err = new Error("Not found");
        (err as unknown as { statusCode: number }).statusCode = 404;
        throw err;
      }
    } as unknown as OpenProjectClient;

    const results = await searchWikiPages({ query: "architecture" }, mockClient);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("System Architecture");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/wikis.test.ts`
Expected: FAIL (`src/services/wikis.ts` does not exist).

- [ ] **Step 3: Implement `src/services/wikis.ts`**

Write `src/services/wikis.ts` with in-memory caching scanner, ID discovery with consecutive 404 cutoff, project resolution, and attachments loading.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/wikis.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/wikis.ts tests/wikis.test.ts
git commit -m "feat: add wikis domain service with caching discovery search"
```

---

### Task 4: MCP Tools: Work Package Activities Tool

**Files:**
- Modify: `src/tools/work-packages.ts`
- Modify: `tests/tools.test.ts`

**Interfaces:**
- Consumes: `listWorkPackageActivities` from `src/services/work-packages.ts`.
- Produces: `listWorkPackageActivitiesTool` registered in `workPackageTools`.

- [ ] **Step 1: Write test for `openproject_list_work_package_activities` in `tests/tools.test.ts`**

Add assertion verifying tool schema, parameters, and `readOnly: true`.

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/tools.test.ts`
Expected: FAIL (tool not defined in `workPackageTools`).

- [ ] **Step 3: Define tool in `src/tools/work-packages.ts`**

Export `listWorkPackageActivitiesTool`:
- Name: `openproject_list_work_package_activities`
- Description: "Retrieve timeline activities and comments for a work package. Can optionally filter to only include user comments."
- Parameters: `workPackageId` (`z.number()`), `onlyComments` (`z.boolean().optional().default(false)`).
- `readOnly: true`.
- Add to `workPackageTools` array.

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test tests/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/work-packages.ts tests/tools.test.ts
git commit -m "feat: add openproject_list_work_package_activities MCP tool"
```

---

### Task 5: MCP Tools: Meetings Tools

**Files:**
- Create: `src/tools/meetings.ts`
- Test: `tests/tools.test.ts`

**Interfaces:**
- Consumes: `listMeetings`, `getMeeting`, `searchMeetings` from `src/services/meetings.ts`.
- Produces: `meetingsTools` array containing:
  - `openproject_list_meetings`
  - `openproject_get_meeting`
  - `openproject_search_meetings`

- [ ] **Step 1: Write tests in `tests/tools.test.ts` verifying the three meetings tools**

Assert `meetingsTools` exists, exports the 3 tools, and all are `readOnly: true`.

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/tools.test.ts`
Expected: FAIL (`src/tools/meetings.ts` does not exist).

- [ ] **Step 3: Implement `src/tools/meetings.ts`**

Define the 3 tools with Zod input schemas and handlers invoking domain service functions.

- [ ] **Step 4: Run test to verify pass**

Run: `bun test tests/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/meetings.ts tests/tools.test.ts
git commit -m "feat: add meetings MCP tools"
```

---

### Task 6: MCP Tools: Wikis Tools

**Files:**
- Create: `src/tools/wikis.ts`
- Test: `tests/tools.test.ts`

**Interfaces:**
- Consumes: `getWikiPage`, `searchWikiPages`, `listWikiPageLinks` from `src/services/wikis.ts`.
- Produces: `wikisTools` array containing:
  - `openproject_get_wiki_page`
  - `openproject_search_wiki_pages`
  - `openproject_list_wiki_page_links`

- [ ] **Step 1: Write tests in `tests/tools.test.ts` verifying the three wikis tools**

Assert `wikisTools` exists, exports the 3 tools, and all are `readOnly: true`.

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/tools.test.ts`
Expected: FAIL (`src/tools/wikis.ts` does not exist).

- [ ] **Step 3: Implement `src/tools/wikis.ts`**

Define the 3 tools with Zod input schemas and handlers invoking domain service functions.

- [ ] **Step 4: Run test to verify pass**

Run: `bun test tests/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/wikis.ts tests/tools.test.ts
git commit -m "feat: add wikis MCP tools"
```

---

### Task 7: Tool Registry & Server Integration

**Files:**
- Modify: `src/tools/index.ts`
- Modify: `src/services/index.ts`
- Modify: `tests/tools.test.ts`
- Modify: `tests/mcp-server.test.ts`
- Modify: `tests/read-only.test.ts`
- Modify: `tests/openapi.test.ts`
- Modify: `tests/http-server.test.ts`

**Interfaces:**
- Consumes: all tools from `meetings.ts`, `wikis.ts`, `work-packages.ts`.
- Produces: `allTools` array containing 18 tools total.

- [ ] **Step 1: Update registry in `src/tools/index.ts` and `src/services/index.ts`**

Import and add `meetingsTools` (3) and `wikisTools` (3) to `allTools`. Re-export all services in `src/services/index.ts`.

- [ ] **Step 2: Update all tool count assertions from 11 to 18**

Update `tests/tools.test.ts`, `tests/mcp-server.test.ts`, `tests/read-only.test.ts`, `tests/openapi.test.ts`, and `tests/http-server.test.ts` where total count `11` was asserted.

- [ ] **Step 3: Run entire test suite**

Run: `bun test`
Expected: PASS all tests across all test suites.

- [ ] **Step 4: Commit**

```bash
git add src/tools/index.ts src/services/index.ts tests/
git commit -m "feat: wire meetings, wikis, and activities tools into server registry (18 tools)"
```

---

### Task 8: Live Container Integration Tests

**Files:**
- Modify: `tests/services.test.ts`
- Modify: `tests/mcp-server.test.ts`

- [ ] **Step 1: Add live container tests in `tests/services.test.ts`**

Add tests for:
- `listMeetings` against live OpenProject container (verifying meetings 2..5).
- `getMeeting` verifying agenda items on meeting 2.
- `searchMeetings` verifying query "Weekly" matches.
- `getWikiPage` querying wiki page 1.
- `searchWikiPages` querying "Wiki".
- `listWorkPackageActivities` querying work package 38.

- [ ] **Step 2: Run live integration tests**

Run: `bun test tests/services.test.ts`
Expected: PASS with real container responses.

- [ ] **Step 3: Commit**

```bash
git add tests/services.test.ts tests/mcp-server.test.ts
git commit -m "test: add live container tests for meetings, wikis, and activities"
```

---

### Task 9: Documentation & Architectural Decision Records

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/TODO.md`
- Modify: `README.md`

- [ ] **Step 1: Record ADR-018 in `docs/DECISIONS.md`**

Document architecture for Meetings, Wikis, and Activities tools and the smart caching discovery strategy for wiki pages.

- [ ] **Step 2: Update `docs/ARCHITECTURE.md`**

Add Meetings and Wikis domains to the architecture guide and update tool listings.

- [ ] **Step 3: Update `docs/TODO.md`**

Mark the new tools as completed and update the roadmap.

- [ ] **Step 4: Update `README.md`**

Update tools catalog table with all 18 tools and descriptions.

- [ ] **Step 5: Run full verification suite**

Run: `bun test`

- [ ] **Step 6: Commit**

```bash
git add docs/DECISIONS.md docs/ARCHITECTURE.md docs/TODO.md README.md
git commit -m "docs: record ADR-018 and update documentation for meetings, wikis, and activities tools"
```
