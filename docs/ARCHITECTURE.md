# Architecture Documentation: openproject-mcp

## 1. System Overview

`openproject-mcp` is a Model Context Protocol (MCP) server providing LLM applications (Claude Desktop, Cursor, Antigravity, etc.) with structured access to an OpenProject instance. The server interfaces with OpenProject's REST API v3 using personal API keys, exposing tools and resources for browsing and querying projects, work packages, custom queries, taxonomies, and users.

```mermaid
flowchart LR
    subgraph Clients ["MCP Clients (Multi-User)"]
        UserA["User A Client\n(Key A)"]
        UserB["User B Client\n(Key B)"]
    end

    subgraph Transports ["Transport Layer"]
        Stdio["Stdio Transport\n(Personal Process Isolation)"]
        SSE["SSE / HTTP Transport\n(Shared Central Daemon)"]
    end

    subgraph ContextLayer ["Session & Request Context Provider"]
        ALS["AsyncLocalStorage /\nSession Context Resolver"]
        CtxA["RequestContext A\n(Client A, Key A)"]
        CtxB["RequestContext B\n(Client B, Key B)"]
    end

    subgraph DomainServices ["Domain Services (Stateless)"]
        ProjSvc["Projects Service"]
        WpSvc["Work Packages Service\n(& Activities)"]
        QuerySvc["Queries Service"]
        MetaSvc["Metadata & Taxonomies"]
        OpenApiSvc["OpenAPI Introspection"]
        MeetSvc["Meetings Service"]
        WikiSvc["Wikis Service"]
    end

    subgraph Remote ["OpenProject Instance"]
        ApiV3["OpenProject REST API v3\n(/api/v3 - RBAC Enforced)"]
    end

    UserA -->|stdio or HTTP headers| Stdio
    UserB -->|HTTP headers| SSE
    Stdio --> ALS
    SSE --> ALS
    ALS --> CtxA
    ALS --> CtxB
    CtxA --> DomainServices
    CtxB --> DomainServices
    DomainServices -->|Authenticated API Requests| ApiV3
```

---

## 2. Core Architectural Layers

The system is organized into four modular layers:

### 2.1. MCP Server & Transport Layer
- **Runtime**: **Bun** (>= 1.2/1.3) providing native TypeScript execution without build steps, automatic `.env` loading, and fast startup for CLI/stdio subprocesses.
- **Responsibility**: Manages the MCP connection lifecycle, tool definitions, input validation, and JSON-RPC dispatching.
- **Protocol**: MCP specification implemented via `@modelcontextprotocol/sdk`.
- **Default Transport**: `StdioServerTransport` for local integration with desktop clients and CLI tools.
- **Remote Transport**: Native `Bun.serve` HTTP/SSE server (`src/http-server.ts`) supporting multi-tenant sessions over Server-Sent Events (`text/event-stream`).
- **Schema Validation**: Each tool declares its arguments using Zod schemas, automatically generating standard JSON Schema definitions for the LLM.

### 2.2. Domain Services / Tool Providers
Domain services map MCP tool calls to concrete business logic and OpenProject API operations:
- **Projects Service**: Listing accessible projects, retrieving project details, and fetching project-level schemas.
- **Work Packages Service**: Listing work packages with filters, searching by text or ID, retrieving work package details, inspecting relations, and browsing work package timeline activities and comments.
- **Queries Service**: Listing saved queries (views) configured in OpenProject and executing them.
- **Metadata & Taxonomies Service**: Retrieving statuses, work package types, priorities, categories, versions, and users to enable LLMs to construct valid queries and interpret responses.
- **OpenAPI Introspection Service**: Dynamic API v3 schema introspection, endpoint parameter schemas, tag discovery, and model definitions with in-memory caching.
- **Meetings Service**: Listing and filtering meetings (upcoming/past), retrieving meeting details with structured agenda items, sections, and outcomes, and deep keyword search across meeting titles, locations, and agenda item notes.
- **Wikis Service**: Retrieving wiki pages with embedded attachments, smart discovery search across wiki pages using cached harvesting and consecutive 404 cutoff, and listing wiki page links to work packages.

### 2.3. OpenProject Client Layer
- **HTTP Transport**: Handles HTTPS communication against the configured `OPENPROJECT_BASE_URL`.
- **Authentication Handler**: Enforces OpenProject API v3 authentication by injecting `Authorization: Basic base64(apikey:<api_key>)` headers.
- **HAL+JSON Parser**: OpenProject API v3 represents entities using HAL+JSON format (`_links`, `_embedded`). The parser unwraps links, extracts embedded entities, and converts them into clean, token-efficient JSON structures for LLM consumption.
- **Query Filter Builder**: Serializes user-friendly filtering parameters into OpenProject's JSON-based filter query syntax (e.g. `filters=[{"status_id":{"operator":"o","values":[]}}]`).
- **Error Normalizer**: Intercepts HTTP 4xx/5xx responses and maps them to descriptive MCP tool errors without exposing sensitive credential data.

### 2.4. Configuration & Environment Layer
- Parses and validates configuration at startup:
  - `OPENPROJECT_BASE_URL`: Base URL of the OpenProject instance (e.g., `https://openproject.example.com`).
  - `OPENPROJECT_API_KEY`: User API key generated in OpenProject under "My Account > Access tokens" (required in stdio mode; optional in HTTP/SSE mode).
  - `OPENPROJECT_READ_ONLY`: Boolean flag (`true` / `false`, default: `false`). Can also be set via `--read-only` CLI argument.
  - `PORT`: HTTP server listening port (e.g. `3000` or `--port <num>`). When set, activates HTTP/SSE remote transport. Supports `HOST_PORT` as an environment variable fallback.
  - `HOST`: Server bind address (or `--host <addr>`, default: `0.0.0.0`).
- Fails fast with actionable setup advice if required credentials are missing or invalid in stdio mode.

### 2.5. Read-Only Execution Mode
The server supports a dedicated read-only operating mode designed for auditing, reporting, and exploratory agent workflows:
- **Tool Filtering**: When read-only mode is active, only read/browse/query tools are registered in the MCP tool registry. Mutating tools (creating work packages, updating attributes, logging time) are completely excluded from the tool manifest exposed to the LLM.
- **Defense-in-Depth Guard**: In addition to tool manifest omission, the internal tool router validates whether an operation is a mutating action. Any write attempt is immediately rejected with a structured error (`SERVER_READ_ONLY: Server is operating in read-only mode. Write operations are disabled.`).
- **Safe Auditing**: Guarantees zero unintentional data modification or state changes in the OpenProject instance.

---

## 3. Multi-User Concurrency & Request-Scoped Architecture

The server is architected from the ground up to support concurrent, multi-user operations safely without cross-user credential leakage, state bleed, or privilege escalation.

### 3.1. Core Concurrency Rules
1. **Zero Global Mutable State**: No global singleton `OpenProjectClient` or static API key variable exists.
2. **Stateless Domain Services**: All domain services (`ProjectsService`, `WorkPackagesService`, etc.) are stateless and operate exclusively on the `RequestContext` resolved for the active execution.
3. **RequestContext Interface**:
   ```typescript
   export interface RequestContext {
     client: OpenProjectClient;
     isReadOnly: boolean;
     sessionId?: string;
     userId?: string;
   }
   ```
4. **Context Propagation via AsyncLocalStorage**:
   In Bun/TypeScript, request context is propagated down asynchronous call trees using `AsyncLocalStorage<RequestContext>`. Tool handlers access `getRequestContext()` to obtain their session's isolated client and read-only flags cleanly.

### 3.2. Supported Deployment Models

#### Model A: Local Personal Desktop (Stdio Transport - Default)
- **Deployment**: The MCP client (Claude Desktop, Cursor, local CLI) spawns `openproject-mcp` as a dedicated child process communicating via standard input/output.
- **Isolation**: OS-level process and memory boundary.
- **Credentials**: Passed via process environment variables or local MCP client configuration.
- **Security**: Complete isolation. Zero network ports exposed.

#### Model B: Centralized Shared Server (SSE / HTTP Transport)
- **Deployment**: A single shared `openproject-mcp` daemon runs centrally for a team or cluster (via `docker-compose.server.yml` or `PORT=3000`).
- **Isolation**: Connection and request-level isolation.
- **Endpoints**:
  - `GET /health`: Health probe returning server status and mode.
  - `GET /sse`: Persistent SSE stream establishing an isolated session.
  - `POST /messages?sessionId=<uuid>`: JSON-RPC message ingestion routed to the active session.
- **Credential Delivery & Extraction Precedence**:
  - Each connecting client supplies their OpenProject API token via:
    1. `Authorization: Bearer <key>`
    2. `X-OpenProject-Api-Key: <key>`
    3. `?apiKey=<key>` query parameter
  - Unauthenticated connection requests are rejected immediately with HTTP 401 Unauthorized.
  - The transport layer instantiates an ephemeral, per-session `OpenProjectClient` and executes tool calls inside `runWithContext({ client, isReadOnly }, ...)`.
- **RBAC Enforcement**: All calls execute against OpenProject REST API v3 using that specific user's token. OpenProject's internal Role-Based Access Control guarantees users only retrieve projects and work packages they have permission to access.
- **Lifecycle & Memory Safety**: Abort signal listeners (`req.signal`) and stream cancellation handlers evict closed sessions from active memory, guaranteeing zero memory leaks.

---

## 4. Tool Specifications (Browse & Query Scope - 18 Tools)

| MCP Tool Name | Description | Key Parameters |
| :--- | :--- | :--- |
| `openproject_list_projects` | List projects accessible to the authenticated user | `pageSize`, `offset`, `sortBy` |
| `openproject_get_project` | Get details of a single project by ID or identifier | `projectId` (number or string identifier) |
| `openproject_list_work_packages` | Browse work packages with filtering and pagination | `projectId`, `status`, `type`, `pageSize`, `offset`, `filters` |
| `openproject_get_work_package` | Get full details of a specific work package | `workPackageId` (number) |
| `openproject_list_work_package_activities` | Retrieve timeline activities and comments for a work package | `workPackageId` (number), `onlyComments` (boolean) |
| `openproject_list_queries` | List saved project or global queries (views) | `projectId`, `pageSize`, `offset` |
| `openproject_get_query` | Retrieve details and results of a saved query | `queryId` (number) |
| `openproject_list_types` | List all available work package types (Task, Bug, Milestone, etc.) | None |
| `openproject_list_statuses` | List all available work package statuses (New, In Progress, Closed, etc.) | None |
| `openproject_list_priorities` | List all priority levels | None |
| `openproject_list_users` | List users in the OpenProject instance | `pageSize`, `offset` |
| `openproject_get_openapi_spec` | Retrieve OpenProject API v3 OpenAPI specification for schema introspection | `summary`, `path`, `tag`, `schema` |
| `openproject_list_meetings` | List and filter meetings visible to the user | `projectId`, `time`, `offset`, `pageSize` |
| `openproject_get_meeting` | Retrieve detailed meeting information including agenda items, sections, notes, and participants | `id` (number), `includeAgendaItems` (boolean) |
| `openproject_search_meetings` | Search across meetings and agenda items by keywords | `query` (string), `projectId`, `offset`, `pageSize` |
| `openproject_get_wiki_page` | Retrieve wiki page metadata, project, and attachments by numeric ID | `id` (number) |
| `openproject_search_wiki_pages` | Discover and search wiki pages matching keywords or project | `query`, `projectId`, `limit`, `refreshCache` |
| `openproject_list_wiki_page_links` | List links connecting work packages to wiki pages | `workPackageId`, `offset`, `pageSize` |

---

## 5. OpenProject API v3 Specifics

### 5.1. Authentication Details
OpenProject API v3 utilizes HTTP Basic Authentication for API tokens:
```http
GET /api/v3/projects HTTP/1.1
Host: openproject.example.com
Authorization: Basic YXBpa2V5OnlvdXItb3BlbnByb2plY3QtYXBpLWtleQ==
Accept: application/hal+json
```
Where `YXBpa2V5OnlvdXItb3BlbnByb2plY3QtYXBpLWtleQ==` is the Base64 encoding of `apikey:<your-api-key>`.

### 5.2. HAL+JSON Handling
API responses contain `_links` linking to related resources (parent project, author, assignee, status, type). The client layer normalizes these into human-readable labels and numeric IDs so the LLM agent can reason over them easily.

### 5.3. Filter Syntax Translation
OpenProject filters are passed via a URL-encoded JSON string array. Example:
```json
[
  { "status_id": { "operator": "o", "values": [] } },
  { "project": { "operator": "=", "values": ["12"] } }
]
```
The client layer provides helper builders so tools can accept friendly parameters (e.g. `{ onlyOpen: true, projectId: 12 }`) and translate them automatically into the required format.

---

## 6. Security & Isolation

1. **Token Protection**: Credentials are read from environment variables or per-connection HTTP headers. Tokens are never echoed in logs or tool payloads.
2. **Permission Boundary**: The MCP server operates strictly within the permission scope of the provided API key. No elevated access is granted beyond what the user possesses in OpenProject.
3. **Input Sanitization**: All arguments from the LLM are validated via Zod schemas prior to making network requests, preventing request-smuggling or path traversal.
4. **Transport Isolation**: The default stdio transport communicates only through standard input/output with the host client process, with no exposed network ports.
5. **Read-Only Enforcement**: Configurable read-only mode (`OPENPROJECT_READ_ONLY=true`) guarantees zero write side-effects on the OpenProject instance when operating in exploratory or untrusted agent sessions.
6. **Multi-Tenant Memory Isolation**: Ephemeral `RequestContext` instances isolated via `AsyncLocalStorage` guarantee zero token bleed or cross-user contamination in concurrent shared server environments.

---

## 7. Project Directory Structure

```
openproject-mcp/
├── docs/
│   ├── ARCHITECTURE.md          # System architecture and specifications
│   ├── DECISIONS.md             # Architecture Decision Records (ADR)
│   ├── plans/                   # Implementation plans
│   ├── specs/                   # Technical designs and specifications
│   └── TODO.md                  # Task tracking and roadmap
├── docker-compose.yml           # Local OpenProject 17 testing stack
├── docker-compose.server.yml    # Production hosted remote MCP server stack
├── Dockerfile                   # Multi-stage container image definition
├── src/
│   ├── index.ts                 # Dual-transport CLI entry point (stdio & HTTP)
│   ├── server.ts                # Stdio MCP server factory & tool registration
│   ├── http-server.ts           # Hosted HTTP/SSE/OpenAPI multi-tenant server (Bun.serve)
│   ├── openapi-spec.ts          # OpenAPI 3.1.0 specification generator for MCP tools
│   ├── context.ts               # RequestContext & AsyncLocalStorage
│   ├── client/
│   │   ├── api-client.ts        # OpenProject REST API v3 HTTP client
│   │   ├── hal-parser.ts        # HAL+JSON parsing and transformation
│   │   ├── filter-builder.ts    # OpenProject JSON filter builder
│   │   └── types.ts             # OpenProject API type definitions
│   ├── config/
│   │   └── index.ts             # Configuration loader and Zod schema
│   ├── services/
│   │   ├── helper.ts            # Client and project resolution helpers
│   │   ├── projects.ts          # Projects domain service
│   │   ├── work-packages.ts     # Work packages & activities domain service
│   │   ├── queries.ts           # Queries domain service
│   │   ├── metadata.ts          # Types, statuses, priorities, users
│   │   ├── openapi.ts           # OpenAPI specification discovery & caching
│   │   ├── meetings.ts          # Meetings domain service & search
│   │   └── wikis.ts             # Wikis domain service & discovery cache
│   └── tools/
│       ├── common.ts            # Common schemas and error formatters
│       ├── index.ts             # Tool registration and execution wrapper
│       ├── metadata.ts          # MCP tool definitions for metadata
│       ├── openapi.ts           # MCP tool definition for OpenAPI introspection
│       ├── projects.ts          # MCP tool definitions for projects
│       ├── queries.ts           # MCP tool definitions for saved queries
│       ├── work-packages.ts     # MCP tool definitions for work packages & activities
│       ├── meetings.ts          # MCP tool definitions for meetings
│       └── wikis.ts             # MCP tool definitions for wikis
├── tests/
│   ├── fixtures/                # HAL+JSON mock fixtures
│   ├── client.test.ts           # OpenProject client unit tests
│   ├── config.test.ts           # Configuration loader unit tests
│   ├── docker.test.ts           # Docker packaging and compose tests
│   ├── http-server.test.ts      # Hosted HTTP/SSE server and protocol tests
│   ├── mcp-server.test.ts       # MCP server stdio integration tests
│   ├── meetings.test.ts         # Meetings domain service tests
│   ├── openapi.test.ts          # OpenAPI service and tool tests
│   ├── read-only.test.ts        # Read-only execution mode guard tests
│   ├── services.test.ts         # Domain services integration tests
│   ├── smoke.test.ts            # Metadata and smoke tests
│   ├── tools.test.ts            # Tool registration unit tests
│   ├── wikis.test.ts            # Wikis domain service tests
│   └── work-package-activities.test.ts # Activities service unit tests
├── AGENTS.md                    # Operating guidelines for AI agents
├── package.json                 # Project dependencies and scripts
├── bun.lock                     # Bun dependency lockfile
└── tsconfig.json                # TypeScript compiler configuration (Bun bundler mode)
```

---

## 8. Future Roadmap

- **Phase 1 (Completed)**: Read/browse capability for projects, work packages, queries, taxonomies, and OpenAPI introspection.
- **Phase 4 (Completed)**: Hosted remote MCP server (HTTP/SSE transport via `Bun.serve`) with multi-tenant per-session credential scoping and Docker Compose deployment.
- **Phase 3 Extension (Completed)**: Read-only collaboration tools across Meetings (listing, detail inspection, deep keyword search across agenda notes), Wikis (page retrieval, smart discovery search, and links), and Work Package Activities (history and comments filtering). Total catalog: 18 tools.
- **Phase 2 (Upcoming)**: Mutating operations (create/update work packages, add comments, log time).
- **Phase 3 (Future)**: Attachment binary download resources.
