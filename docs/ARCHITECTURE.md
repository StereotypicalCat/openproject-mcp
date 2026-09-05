# Architecture Documentation: openproject-mcp

## 1. System Overview

`openproject-mcp` is a Model Context Protocol (MCP) server providing LLM applications (Claude Desktop, Cursor, Antigravity, etc.) with structured access to an OpenProject instance. The server interfaces with OpenProject's REST API v3 using personal API keys, exposing tools and resources for browsing and querying projects, work packages, custom queries, taxonomies, and users.

```mermaid
flowchart LR
    subgraph Client ["MCP Client"]
        Agent["LLM Agent / Assistant"]
    end

    subgraph Server ["openproject-mcp Server"]
        Transport["Stdio Transport"]
        Router["Tool & Resource Router"]
        
        subgraph DomainServices ["Domain Services"]
            ProjSvc["Projects Service"]
            WpSvc["Work Packages Service"]
            QuerySvc["Queries Service"]
            MetaSvc["Metadata & Taxonomies"]
        end

        ClientCore["OpenProject API Client"]
        AuthHandler["Auth & Request Builder\n(Basic Auth: apikey:<token>)"]
        HalParser["HAL+JSON Parser & Normalizer"]
    end

    subgraph Remote ["OpenProject Instance"]
        ApiV3["REST API v3 (/api/v3)"]
    end

    Agent <-->|MCP JSON-RPC (stdio)| Transport
    Transport <--> Router
    Router --> DomainServices
    DomainServices --> ClientCore
    ClientCore --> AuthHandler
    ClientCore --> HalParser
    AuthHandler -->|HTTPS Requests| ApiV3
    ApiV3 -->|HAL+JSON Responses| HalParser
```

---

## 2. Core Architectural Layers

The system is organized into four modular layers:

### 2.1. MCP Server & Transport Layer
- **Responsibility**: Manages the MCP connection lifecycle, tool definitions, input validation, and JSON-RPC dispatching.
- **Protocol**: MCP specification implemented via `@modelcontextprotocol/sdk`.
- **Default Transport**: `StdioServerTransport` for local integration with desktop clients and CLI tools.
- **Schema Validation**: Each tool declares its arguments using Zod schemas, automatically generating standard JSON Schema definitions for the LLM.

### 2.2. Domain Services / Tool Providers
Domain services map MCP tool calls to concrete business logic and OpenProject API operations:
- **Projects Service**: Listing accessible projects, retrieving project details, and fetching project-level schemas.
- **Work Packages Service**: Listing work packages with filters, searching by text or ID, retrieving work package details, and inspecting relations.
- **Queries Service**: Listing saved queries (views) configured in OpenProject and executing them.
- **Metadata & Taxonomies Service**: Retrieving statuses, work package types, priorities, categories, versions, and users to enable LLMs to construct valid queries and interpret responses.

### 2.3. OpenProject Client Layer
- **HTTP Transport**: Handles HTTPS communication against the configured `OPENPROJECT_BASE_URL`.
- **Authentication Handler**: Enforces OpenProject API v3 authentication by injecting `Authorization: Basic base64(apikey:<api_key>)` headers.
- **HAL+JSON Parser**: OpenProject API v3 represents entities using HAL+JSON format (`_links`, `_embedded`). The parser unwraps links, extracts embedded entities, and converts them into clean, token-efficient JSON structures for LLM consumption.
- **Query Filter Builder**: Serializes user-friendly filtering parameters into OpenProject's JSON-based filter query syntax (e.g. `filters=[{"status_id":{"operator":"o","values":[]}}]`).
- **Error Normalizer**: Intercepts HTTP 4xx/5xx responses and maps them to descriptive MCP tool errors without exposing sensitive credential data.

### 2.4. Configuration & Environment Layer
- Parses and validates configuration at startup:
  - `OPENPROJECT_BASE_URL`: Base URL of the OpenProject instance (e.g., `https://openproject.example.com`).
  - `OPENPROJECT_API_KEY`: User API key generated in OpenProject under "My Account > Access tokens".
- Fails fast with actionable setup advice if required credentials are missing or invalid.

---

## 3. Tool Specifications (Browse & Query Scope)

| MCP Tool Name | Description | Key Parameters |
| :--- | :--- | :--- |
| `openproject_list_projects` | List projects accessible to the authenticated user | `pageSize`, `offset`, `sortBy` |
| `openproject_get_project` | Get details of a single project by ID or identifier | `projectId` (number or string identifier) |
| `openproject_list_work_packages` | Browse work packages with filtering and pagination | `projectId`, `status`, `type`, `pageSize`, `offset`, `filters` |
| `openproject_get_work_package` | Get full details of a specific work package | `workPackageId` (number) |
| `openproject_list_queries` | List saved project or global queries (views) | `projectId`, `pageSize`, `offset` |
| `openproject_get_query` | Retrieve details and results of a saved query | `queryId` (number) |
| `openproject_list_types` | List all available work package types (Task, Bug, Milestone, etc.) | None |
| `openproject_list_statuses` | List all available work package statuses (New, In Progress, Closed, etc.) | None |
| `openproject_list_priorities` | List all priority levels | None |
| `openproject_list_users` | List users in the OpenProject instance | `pageSize`, `offset` |

---

## 4. OpenProject API v3 Specifics

### 4.1. Authentication Details
OpenProject API v3 utilizes HTTP Basic Authentication for API tokens:
```http
GET /api/v3/projects HTTP/1.1
Host: openproject.example.com
Authorization: Basic YXBpa2V5OnlvdXItb3BlbnByb2plY3QtYXBpLWtleQ==
Accept: application/hal+json
```
Where `YXBpa2V5OnlvdXItb3BlbnByb2plY3QtYXBpLWtleQ==` is the Base64 encoding of `apikey:<your-api-key>`.

### 4.2. HAL+JSON Handling
API responses contain `_links` linking to related resources (parent project, author, assignee, status, type). The client layer normalizes these into human-readable labels and numeric IDs so the LLM agent can reason over them easily.

### 4.3. Filter Syntax Translation
OpenProject filters are passed via a URL-encoded JSON string array. Example:
```json
[
  { "status_id": { "operator": "o", "values": [] } },
  { "project": { "operator": "=", "values": ["12"] } }
]
```
The client layer provides helper builders so tools can accept friendly parameters (e.g. `{ onlyOpen: true, projectId: 12 }`) and translate them automatically into the required format.

---

## 5. Security & Isolation

1. **Token Protection**: Credentials are read from environment variables or standard config files. Tokens are never echoed in logs or responses.
2. **Permission Boundary**: The MCP server operates with the exact permission scope of the provided API key. No elevated access is granted beyond what the user possesses in OpenProject.
3. **Input Sanitization**: All arguments from the LLM are validated via Zod schemas prior to making network requests, preventing request-smuggling or path traversal.
4. **Transport Isolation**: The default stdio transport communicates only through standard input/output with the host client process, with no exposed network ports.

---

## 6. Project Directory Structure

```
openproject-mcp/
├── docs/
│   ├── ARCHITECTURE.md          # System architecture and specifications
│   └── DECISIONS.md             # Architecture Decision Records (ADR)
├── src/
│   ├── index.ts                 # CLI entry point and startup
│   ├── server.ts                # MCP server instance & tool registration
│   ├── client/
│   │   ├── api-client.ts        # OpenProject REST API v3 HTTP client
│   │   ├── hal-parser.ts        # HAL+JSON parsing and transformation
│   │   ├── filter-builder.ts    # OpenProject JSON filter builder
│   │   └── types.ts             # OpenProject API type definitions
│   ├── config/
│   │   └── index.ts             # Configuration loader and Zod schema
│   ├── services/
│   │   ├── projects.ts          # Projects domain service
│   │   ├── work-packages.ts     # Work packages domain service
│   │   ├── queries.ts           # Queries domain service
│   │   └── metadata.ts          # Types, statuses, priorities, users
│   └── tools/
│       ├── project-tools.ts     # MCP tool definitions for projects
│       ├── work-package-tools.ts# MCP tool definitions for work packages
│       └── metadata-tools.ts    # MCP tool definitions for metadata
├── tests/
│   ├── fixtures/                # HAL+JSON mock fixtures
│   ├── client.test.ts           # OpenProject client unit tests
│   └── tools.test.ts            # MCP tool integration tests
├── AGENTS.md                    # Operating guidelines for AI agents
├── package.json                 # Project dependencies and scripts
└── tsconfig.json                # TypeScript compiler configuration
```

---

## 7. Future Roadmap

- **Phase 1 (Current)**: Read/browse capability for projects, work packages, queries, and taxonomies.
- **Phase 2**: Mutating operations (create/update work packages, add comments, log time).
- **Phase 3**: Attachment inspection and download resources.
- **Phase 4**: SSE / Stream transport for remote server deployments and multi-user environments.
