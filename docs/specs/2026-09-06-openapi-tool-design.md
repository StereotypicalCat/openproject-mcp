# Specification: OpenProject OpenAPI Specification Tool (`openproject_get_openapi_spec`)

## 1. Overview & Objectives

OpenProject REST API v3 provides an instance-specific OpenAPI 3.0 specification at `GET /api/v3/openapi.json`. This dynamic document describes all API endpoints, parameters, request bodies, and schema models supported by the connected OpenProject instance.

However, the raw JSON document is approximately **1.18 MB** (over 220 path endpoints, 60+ tags, and dozens of component schemas). Returning this payload unconditionally to an LLM would consume ~300,000 tokens, degrading agent reasoning or causing token limit exceptions.

### Primary Objectives
1. Provide an MCP tool `openproject_get_openapi_spec` for dynamic endpoint and schema introspection.
2. Implement **Smart Scoping & Filtering** so agents can query:
   - **Summary mode** (default): High-level overview of available tags and endpoints without blowing up the context window.
   - **Path mode**: Exact or prefix match for a specific endpoint (e.g. `/api/v3/work_packages`).
   - **Tag mode**: Operations grouped by functional domain (e.g. `"Work Packages"`, `"Projects"`).
   - **Schema mode**: Component models from `components.schemas` (e.g. `"WorkPackageModel"`).
   - **Full mode**: Complete raw document when explicitly requested (`full: true`).
3. Implement **In-Memory Caching** keyed by `baseUrl` to avoid re-fetching ~1.18 MB on every tool call, with an optional `refresh: true` cache bypass.
4. Mark the tool as `readOnly: true`, making it available in both read-only and read-write modes.

---

## 2. Architecture & Components

```
   MCP Client (Claude / Antigravity / Cursor)
                     │
                     ▼
         McpServer (src/server.ts)
                     │
                     ▼ wrapExecute (RequestContext)
     openproject_get_openapi_spec (src/tools/openapi.ts)
                     │
                     ▼
       getOpenApiSpec (src/services/openapi.ts)
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
 [In-Memory Cache]      OpenProjectClient.get("openapi.json")
 (by baseUrl)                     │
                                  ▼
                         OpenProject 17 API v3
```

### 2.1 Domain Service Layer (`src/services/openapi.ts`)
- **Query Options**:
  ```typescript
  export interface OpenApiQueryOptions {
    path?: string;
    tag?: string;
    schema?: string;
    full?: boolean;
    refresh?: boolean;
  }
  ```
- **Caching Mechanism**:
  - `const openApiCache = new Map<string, unknown>();`
  - Cached parsed JSON object keyed by `client.baseUrl`.
  - When `options.refresh` is true, the cached entry is evicted and a fresh `GET /api/v3/openapi.json` is performed.
- **Path Normalization**:
  - Automatically handles `/api/v3` prefix differences (e.g. `work_packages`, `/work_packages`, and `/api/v3/work_packages` resolve identically).
  - Performs case-insensitive matching.
- **Summary Extraction**:
  - Generates an overview object containing `title`, `version`, `openapi`, `totalPaths`, `tags` (with endpoint counts), and an indexed list of available paths with query instructions.

### 2.2 MCP Tool Layer (`src/tools/openapi.ts`)
- Tool name: `openproject_get_openapi_spec`
- `readOnly: true`
- Zod schema:
  - `path`: `z.string().optional()`
  - `tag`: `z.string().optional()`
  - `schema`: `z.string().optional()`
  - `full`: `z.boolean().optional().default(false)`
  - `refresh`: `z.boolean().optional().default(false)`
- Registration via `registerOpenApiTools` and integration in `allTools` (`src/tools/index.ts`).

---

## 3. Tool Parameters & Output Schemas

### 3.1 Tool Arguments
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | No | - | Endpoint path to inspect (e.g. `"/api/v3/work_packages"` or `"projects"`). |
| `tag` | string | No | - | Tag / category to filter endpoints by (e.g. `"Work Packages"`, `"Queries"`). |
| `schema` | string | No | - | Component schema model name to inspect (e.g. `"WorkPackageModel"`). |
| `full` | boolean | No | `false` | When `true`, returns the complete raw OpenAPI document. |
| `refresh` | boolean | No | `false` | When `true`, forces cache invalidation and re-fetches from server. |

### 3.2 Success Output Formats

#### Summary Mode (Default when no filters provided):
```json
{
  "title": "OpenProject API V3 (Stable)",
  "version": "3",
  "openapi": "3.0.3",
  "totalPaths": 226,
  "tags": [
    { "name": "Work Packages", "endpointCount": 8 },
    { "name": "Projects", "endpointCount": 12 },
    { "name": "Queries", "endpointCount": 5 }
  ],
  "availablePaths": [
    "/api/v3",
    "/api/v3/actions",
    "/api/v3/work_packages",
    "/api/v3/work_packages/{id}"
  ],
  "instructions": "Call openproject_get_openapi_spec with 'path' (e.g. '/api/v3/work_packages'), 'tag' (e.g. 'Work Packages'), or 'schema' (e.g. 'WorkPackageModel') to inspect specific schemas and operations."
}
```

#### Path Mode (`path: "/api/v3/work_packages"`):
```json
{
  "path": "/api/v3/work_packages",
  "operations": {
    "get": {
      "summary": "List work packages",
      "operationId": "list_work_packages",
      "tags": ["Work Packages"],
      "description": "Returns a collection of work packages.",
      "parameters": [...]
    },
    "post": {
      "summary": "Create work package",
      "operationId": "create_work_package",
      "tags": ["Work Packages"],
      "parameters": [...],
      "requestBody": {...}
    }
  }
}
```

#### Tag Mode (`tag: "Queries"`):
```json
{
  "tag": "Queries",
  "totalPaths": 3,
  "paths": {
    "/api/v3/queries": { ... },
    "/api/v3/queries/{id}": { ... },
    "/api/v3/queries/{id}/results": { ... }
  }
}
```

#### Schema Mode (`schema: "WorkPackageModel"`):
```json
{
  "schemaName": "WorkPackageModel",
  "schema": {
    "type": "object",
    "properties": { ... }
  }
}
```

---

## 4. Error Handling

- Non-existent path: returns `Error [OPENPROJECT_NOT_FOUND]: OpenAPI path '<path>' not found in specification. Available paths include: [...]`
- Non-existent tag: returns `Error [OPENPROJECT_NOT_FOUND]: OpenAPI tag '<tag>' not found. Available tags include: [...]`
- Non-existent schema: returns `Error [OPENPROJECT_NOT_FOUND]: OpenAPI component schema '<schema>' not found. Available schemas include: [...]`
- API / Connection failures: captured by `OpenProjectError` and serialized as standard MCP `isError: true` responses.

---

## 5. Testing & Verification

1. **Unit & Mock Tests (`tests/openapi.test.ts`)**:
   - Summary mode returns expected structure and instructions.
   - Path lookup handles exact and normalized matches.
   - Tag lookup filters paths properly.
   - Schema lookup extracts matching component definition.
   - Cache hit avoids duplicate HTTP requests; `refresh: true` triggers re-fetch.
   - Validation rejects invalid argument types.
   - 404 Not Found returns appropriate error messages for missing paths/tags/schemas.
2. **Live Container Tests (`tests/openapi.test.ts`)**:
   - Live query against OpenProject 17 at `http://localhost:8080/api/v3/openapi.json`.
   - Verifies live summary, path inspection (`/api/v3/work_packages`), and tag filtering (`"Work Packages"`).
3. **Existing Suite Updates**:
   - Update `tests/tools.test.ts` and `tests/read-only.test.ts` tool count assertions from 10 to 11.
