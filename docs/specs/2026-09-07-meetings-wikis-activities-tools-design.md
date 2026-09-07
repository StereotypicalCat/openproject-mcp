# Specification: Meetings, Wikis, and Work Package Activities MCP Tools

## 1. Overview & Objectives

This specification defines the extension of the `openproject-mcp` server with seven new read-only tools covering three domains:
1. **Meetings**: Listing meetings, detailed inspection of agendas/notes, and deep keyword search across meeting titles and agenda content.
2. **Wikis**: Retrieving wiki pages, smart caching discovery/search across wiki page titles, and listing wiki page links to work packages.
3. **Work Package Activities & Comments**: Browsing history and timeline events with dedicated comments-only filtering.

All 7 tools are strictly read-only (`readOnly: true`), preserving full functionality in read-only environments while expanding the MCP server catalog from 11 to 18 registered tools.

---

## 2. Architectural Design

```
   MCP Client (Claude / Antigravity / Cursor)
                     │
                     ▼
          McpServer (src/server.ts)
                     │
                     ▼ wrapExecute (RequestContext)
  ┌──────────────────┼──────────────────────────────┐
  │                  │                              │
  ▼                  ▼                              ▼
Meetings Tools      Wikis Tools           Work Package Tools
(src/tools/        (src/tools/            (src/tools/
 meetings.ts)       wikis.ts)              work-packages.ts)
  │                  │                              │
  ▼                  ▼                              ▼
Meetings Service    Wikis Service          Work Packages Service
(src/services/     (src/services/         (src/services/
 meetings.ts)       wikis.ts)              work-packages.ts)
  │                  │                              │
  │                  ├─► In-Memory Discovery Cache  │
  │                  │                              │
  └──────────────────┼──────────────────────────────┘
                     │
                     ▼ OpenProjectClient
           OpenProject 17 API v3
```

### 2.1 Meetings Domain (`src/services/meetings.ts` & `src/tools/meetings.ts`)
- **`listMeetings(params, client)`**:
  - Accepts `projectId` (numeric ID or string identifier), `time` filter (e.g. `"upcoming"`, `"past"`), `offset`, and `pageSize`.
  - Resolves string project identifiers to numeric IDs via `resolveProjectId`.
  - Serializes OpenProject filter syntax: `[{"project_id":{"operator":"=","values":[...]}}]` and optional `time` filter.
  - Calls `GET /api/v3/meetings`.
  - Returns paginated `MeetingSummary` array:
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
    ```
- **`getMeeting(id, options, client)`**:
  - Calls `GET /api/v3/meetings/{id}`.
  - If `options.includeAgendaItems` is true (default: true), concurrently calls `GET /api/v3/meetings/{id}/agenda_items` and unpacks each item.
  - Returns `MeetingDetail`:
    ```typescript
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
    ```
- **`searchMeetings(params, client)`**:
  - Accepts `query` (required), optional `projectId`, `offset`, and `pageSize`.
  - Fetches candidate meetings (scoped to `projectId` if provided).
  - Performs case-insensitive matching against meeting `title` and `location`.
  - Concurrently fetches agenda items for candidate meetings and inspects agenda item `title` and `notes`.
  - Returns `MeetingSearchResult` list:
    ```typescript
    export interface MeetingSearchResult {
      meeting: MeetingSummary;
      matchType: "title" | "location" | "agenda_item";
      matchedAgendaItems?: Array<{
        id: number;
        title: string;
        snippet?: string;
      }>;
    }
    ```

### 2.2 Wikis Domain (`src/services/wikis.ts` & `src/tools/wikis.ts`)
- **`getWikiPage(id, client)`**:
  - Calls `GET /api/v3/wiki_pages/{id}`.
  - Calls `GET /api/v3/wiki_pages/{id}/attachments` to embed attachments.
  - Returns `WikiPageDetail`:
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
    ```
- **`listWikiPageLinks(params, client)`**:
  - If `workPackageId` is provided, queries `/api/v3/work_packages/{workPackageId}/wiki_page_links`.
  - Otherwise, queries `/api/v3/wiki_page_links`.
  - Returns `WikiPageLink` array:
    ```typescript
    export interface WikiPageLink {
      id: number;
      pageTitle?: string;
      pageUrl?: string;
      provider?: string;
      workPackage?: { id: number; title?: string };
    }
    ```
- **`searchWikiPages(params, client)`**:
  - Resolves optional `projectId` (numeric or identifier).
  - Maintains an in-memory cache of discovered wiki pages keyed by `client.baseUrl` (`Map<number, WikiPageDetail>`).
  - Discovery strategy:
    1. Checks `wiki_page_links` to collect referenced wiki pages.
    2. Batch-probes `/api/v3/wiki_pages/{id}` across sequential IDs (e.g. IDs 1..50 with consecutive 404 threshold stop).
    3. Populates cache with discovered pages.
  - Filters cached pages by `projectId` (if specified) and matches `query` against `page.title` (case-insensitive substring).
  - Returns matching `WikiPageSummary` array.

### 2.3 Work Package Activities & Comments (`src/services/work-packages.ts`)
- **`listWorkPackageActivities(params, client)`**:
  - Calls `GET /api/v3/work_packages/{workPackageId}/activities`.
  - Parses each activity:
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
    ```
  - If `onlyComments: true`, filters out activities where `isComment` is false.
  - Returns `PaginatedResult<WorkPackageActivity>`.

---

## 3. Tool Definitions & Zod Schemas

| Tool Name | Parameters | Returns | Description |
|-----------|------------|---------|-------------|
| `openproject_list_meetings` | `projectId` (optional string/number), `time` (optional string), `offset` (optional number), `pageSize` (optional number) | `PaginatedResult<MeetingSummary>` | List and filter meetings visible to the user. |
| `openproject_get_meeting` | `id` (required number), `includeAgendaItems` (optional boolean, default: true) | `MeetingDetail` | Retrieve detailed meeting information including agenda items, sections, and notes. |
| `openproject_search_meetings` | `query` (required string), `projectId` (optional string/number), `offset` (optional number), `pageSize` (optional number) | `PaginatedResult<MeetingSearchResult>` | Deep search across meeting titles, locations, and agenda item notes. |
| `openproject_get_wiki_page` | `id` (required number) | `WikiPageDetail` | Retrieve wiki page metadata, project, and attachments. |
| `openproject_search_wiki_pages` | `query` (optional string), `projectId` (optional string/number), `limit` (optional number, default: 20) | `WikiPageSummary[]` | Discover and search wiki pages matching keywords or project. |
| `openproject_list_wiki_page_links` | `workPackageId` (optional number), `offset` (optional number), `pageSize` (optional number) | `PaginatedResult<WikiPageLink>` | List links connecting work packages to wiki pages. |
| `openproject_list_work_package_activities` | `workPackageId` (required number), `onlyComments` (optional boolean, default: false) | `PaginatedResult<WorkPackageActivity>` | Retrieve timeline activities and comments for a work package. |

All 7 tools: `readOnly: true`.

---

## 4. Error Handling & Edge Cases

1. **Missing Resource (404)**:
   - `openproject_get_meeting` and `openproject_get_wiki_page` throw `OpenProjectNotFoundError` with descriptive message when resource does not exist.
2. **Permission Denied (403)**:
   - Preserves normalized `OpenProjectForbiddenError` when current API key lacks permission to view meetings or wiki pages in target project.
3. **Empty Agenda Items**:
   - Meetings without agenda items return an empty array for `agendaItems: []` without failing.
4. **Consecutive 404s in Wiki Scanner**:
   - The wiki scanner halts probing when encountering consecutive 404 responses (e.g. 5 consecutive misses), avoiding excessive HTTP requests.
5. **Project Identifier Resolution**:
   - `projectId` can be passed as integer (e.g. `1`) or string identifier (e.g. `"demo-project"`), resolved transparently using `resolveProjectId`.

---

## 5. Testing & Verification

1. **Unit & Service Tests (`tests/services.test.ts`, `tests/meetings.test.ts`, `tests/wikis.test.ts`)**:
   - Verify pagination, filters, and schema parsing against mocked HAL responses.
   - Verify wiki scanner caching, project filtering, and title matching.
   - Verify activities comments-only filtering.
2. **MCP Server Integration (`tests/tools.test.ts`, `tests/mcp-server.test.ts`, `tests/read-only.test.ts`)**:
   - Verify registry has 18 tools total.
   - Verify tool schemas and execution via MCP Client in `RequestContext`.
   - Verify that all 18 tools remain registered under `OPENPROJECT_READ_ONLY=true`.
3. **Remote HTTP/SSE & OpenAPI Introspection (`tests/http-server.test.ts`)**:
   - Verify `GET /openapi.json` publishes all 18 tool specifications.
   - Verify `POST /api/tools/:toolName` executes the new tools.
4. **Live OpenProject 17 Container Tests**:
   - Live meeting retrieval against project 1 (`demo-project`, meetings 2-5).
   - Live wiki page inspection against page 1 (`Wiki`).
   - Live work package activity inspection against work package 38.
