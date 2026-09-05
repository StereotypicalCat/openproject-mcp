# Design Specification: Domain Services Layer

- **Date**: 2026-09-05
- **Status**: Draft (Under Review)
- **Target**: `openproject-mcp` Phase 1 (Task 2: Domain Services)
- **Author**: Antigravity Agent & User Pairing

---

## 1. Executive Summary

This specification defines the Domain Services layer for `openproject-mcp`. The Domain Services layer sits directly between the OpenProject REST API v3 client (`src/client/`) and the upcoming MCP tools layer (`src/tools/`).

Domain services provide stateless, strongly-typed TypeScript functions that abstract OpenProject REST endpoints, automate HAL+JSON unpack/normalization, apply LLM-friendly filter translation, and integrate seamlessly with `RequestContext` via `AsyncLocalStorage`.

---

## 2. Architecture & Design Principles

### 2.1. Stateless Functional Modules with Optional Client Override
Each domain service is implemented as a functional module exporting standalone asynchronous functions. Every function accepts an optional `client?: OpenProjectClient` parameter as its final argument:
- **Default Execution**: If `client` is omitted, the service resolves the client from the active execution context via `getRequestContext().client`. This enables MCP tool handlers to call service functions with zero boilerplate.
- **Testing Ergonomics**: If `client` is explicitly provided, the service uses that instance directly. This allows unit tests to test services with mock clients without requiring `AsyncLocalStorage` setup.

### 2.2. Directory & File Organization
All domain service code is placed in `src/services/`:
- `src/services/projects.ts`: Project listing, details, and schema inspection.
- `src/services/work-packages.ts`: Work package browsing, details, and search.
- `src/services/queries.ts`: Saved query listing, query configuration details, and query result execution.
- `src/services/metadata.ts`: System taxonomies including statuses, work package types, priorities, and users.
- `src/services/index.ts`: Unified barrel export for all domain services and related parameter types.

---

## 3. Detailed Component Specifications

### 3.1. Client Resolution Helper
A shared internal utility function `resolveClient(client?: OpenProjectClient): OpenProjectClient` will be used across all service modules:
```typescript
import { getRequestContext } from "../context.ts";
import type { OpenProjectClient } from "../client/api-client.ts";

export function resolveClient(client?: OpenProjectClient): OpenProjectClient {
  return client ?? getRequestContext().client;
}
```

### 3.2. Projects Service (`src/services/projects.ts`)
Interacts with `/api/v3/projects`.

#### Types & Interfaces
```typescript
export interface ListProjectsParams {
  pageSize?: number;
  offset?: number;
  sortBy?: string;
  filters?: FilterElement[];
}
```

#### Functions
1. `listProjects(params?: ListProjectsParams, client?: OpenProjectClient): Promise<PaginatedResult<ProjectSummary>>`
   - Endpoint: `GET /api/v3/projects`
   - Query Parameters: `pageSize`, `offset`, `sortBy`, `filters` (JSON stringified).
   - Response Normalization: `unpackCollection(response, normalizeProjectSummary)`.

2. `getProject(idOrIdentifier: number | string, client?: OpenProjectClient): Promise<ProjectDetail>`
   - Endpoint: `GET /api/v3/projects/{idOrIdentifier}`
   - Response Normalization: `normalizeProject(response)`.

3. `getProjectSchema(client?: OpenProjectClient): Promise<Record<string, unknown>>`
   - Endpoint: `GET /api/v3/projects/schema`
   - Returns the schema definition object for projects.

---

### 3.3. Work Packages Service (`src/services/work-packages.ts`)
Interacts with `/api/v3/work_packages` and project-scoped work package endpoints.

#### Types & Interfaces
```typescript
export interface ListWorkPackagesParams extends WorkPackageFilterParams {
  pageSize?: number;
  offset?: number;
  sortBy?: string;
}

export interface SearchWorkPackagesOptions {
  projectId?: number | string;
  pageSize?: number;
  offset?: number;
}
```

#### Functions
1. `listWorkPackages(params?: ListWorkPackagesParams, client?: OpenProjectClient): Promise<PaginatedResult<WorkPackageSummary>>`
   - Builds filter array using `buildWorkPackageFilters(params)`.
   - Endpoint: `GET /api/v3/work_packages`
   - Query Parameters: `pageSize`, `offset`, `sortBy`, `filters` (JSON stringified).
   - Response Normalization: `unpackCollection(response, normalizeWorkPackageSummary)`.

2. `getWorkPackage(id: number, client?: OpenProjectClient): Promise<WorkPackageDetail>`
   - Endpoint: `GET /api/v3/work_packages/{id}`
   - Response Normalization: `normalizeWorkPackage(response)`.

3. `searchWorkPackages(query: string, options?: SearchWorkPackagesOptions, client?: OpenProjectClient): Promise<PaginatedResult<WorkPackageSummary>>`
   - Convenience wrapper around `listWorkPackages` setting `subject: query` and optional `projectId`.

---

### 3.4. Queries Service (`src/services/queries.ts`)
Interacts with `/api/v3/queries`.

#### Types & Interfaces
```typescript
export interface ListQueriesParams {
  projectId?: number | string;
  pageSize?: number;
  offset?: number;
}

export interface QueryResultsParams {
  pageSize?: number;
  offset?: number;
}
```

#### Functions
1. `listQueries(params?: ListQueriesParams, client?: OpenProjectClient): Promise<PaginatedResult<QuerySummary>>`
   - Endpoint: `GET /api/v3/queries`
   - If `projectId` is provided, adds project filter: `[{"project":{"operator":"=","values":[String(projectId)]}}]`.
   - Query Parameters: `pageSize`, `offset`, `filters`.
   - Response Normalization: `unpackCollection(response, normalizeQuerySummary)`.

2. `getQuery(id: number, client?: OpenProjectClient): Promise<QueryDetail>`
   - Endpoint: `GET /api/v3/queries/{id}`
   - Response Normalization: `normalizeQuery(response)`.

3. `getQueryResults(id: number, params?: QueryResultsParams, client?: OpenProjectClient): Promise<PaginatedResult<WorkPackageSummary>>`
   - Endpoint: `GET /api/v3/queries/{id}/results`
   - Query Parameters: `pageSize`, `offset`.
   - Response Normalization: `unpackCollection(response, normalizeWorkPackageSummary)`.

---

### 3.5. Metadata Service (`src/services/metadata.ts`)
Interacts with `/api/v3/statuses`, `/api/v3/types`, `/api/v3/priorities`, and `/api/v3/users`.

#### Types & Interfaces
```typescript
export interface ListTypesParams {
  projectId?: number | string;
}

export interface ListUsersParams {
  pageSize?: number;
  offset?: number;
  status?: string;
}
```

#### Functions
1. `listStatuses(client?: OpenProjectClient): Promise<StatusItem[]>`
   - Endpoint: `GET /api/v3/statuses`
   - Unpacks collection and extracts elements normalized via `normalizeStatus`.

2. `listTypes(params?: ListTypesParams, client?: OpenProjectClient): Promise<TypeItem[]>`
   - Endpoint: If `projectId` provided: `GET /api/v3/projects/{projectId}/types`, else: `GET /api/v3/types`.
   - Unpacks collection and extracts elements normalized via `normalizeType`.

3. `listPriorities(client?: OpenProjectClient): Promise<PriorityItem[]>`
   - Endpoint: `GET /api/v3/priorities`
   - Unpacks collection and extracts elements normalized via `normalizePriority`.

4. `listUsers(params?: ListUsersParams, client?: OpenProjectClient): Promise<PaginatedResult<UserItem>>`
   - Endpoint: `GET /api/v3/users`
   - Query Parameters: `pageSize`, `offset`.
   - Response Normalization: `unpackCollection(response, normalizeUser)`.

---

## 4. Error Handling & Security

1. **Passthrough of Typed Errors**: Service methods do not swallow or alter domain-specific exceptions raised by `OpenProjectClient` (`OpenProjectNotFoundError`, `OpenProjectAuthenticationError`, `OpenProjectForbiddenError`, `OpenProjectValidationError`, `OpenProjectRateLimitError`).
2. **Credential Sanitization**: The underlying HTTP client already strips API keys from exception messages. Services maintain this safety by avoiding string concatenation containing raw configuration.
3. **Parameter Validation**: Input validation schemas will be enforced at the MCP tool boundary (Task 3 via Zod). Service functions enforce basic defensive checks (e.g. non-empty IDs).

---

## 5. Testing & Verification Strategy

### 5.1. Unit Testing with Mocked Fetch (`tests/services.test.ts`)
- Verify correct URL paths and query parameter encoding for all service functions.
- Verify fallback to `getRequestContext().client` when called inside `runWithContext`.
- Verify behavior when explicit client parameter is provided.
- Verify error propagation when mock returns 404 or 403.

### 5.2. Live Container Integration Testing
- Verify against running local OpenProject 17 container using seeded data:
  - Project `mcp-test-project` (ID 4) returned by `listProjects` and `getProject`.
  - Seeded work packages (IDs 38-41) returned by `listWorkPackages` and `getWorkPackage`.
  - Saved query `MCP Active Tasks` (ID 30) returned by `listQueries`, `getQuery`, and `getQueryResults`.
  - Taxonomies returned by `listStatuses`, `listTypes`, `listPriorities`, and `listUsers`.

---

## 6. Out of Scope (Future Tasks)
- MCP Tool registration and Zod schemas (Task 3: MCP Tool Definitions).
- Mutating operations such as creating/updating work packages (Phase 2).
- File attachment downloads and wikis (Phase 3).
