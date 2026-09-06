# Architecture Decision Records (ADR)

This document records the key architectural and technical decisions made for `openproject-mcp`.

---

## ADR-001: Technology Stack Selection (TypeScript & Node.js)

### Status
Superseded by ADR-010

### Context
We need to build a companion MCP server for OpenProject (https://github.com/opf/openproject) that runs reliably on local machines and integrates smoothly with MCP clients such as Claude Desktop, Cursor, and Antigravity.

Key candidate ecosystems:
1. **TypeScript / Node.js**: Official `@modelcontextprotocol/sdk`, high community adoption, direct JSON handling, first-class typings, fast startup time.
2. **Python**: Python `mcp` SDK, strong for data science, but packaging CLI binaries or distributed environments across non-Python users requires pyinstaller or pipx.

### Decision
Choose **TypeScript** running on **Node.js** (>= 18) with the official `@modelcontextprotocol/sdk`.

### Consequences
- **Positive**:
  - Leverages the most mature and widely-maintained MCP SDK implementation.
  - Native JSON and HAL+JSON data manipulation with strict typing.
  - Simple execution via `npx` or standard Node runner.
  - Excellent developer tooling and linting with TypeScript and ESLint.
- **Negative**:
  - Requires Node.js runtime on the host environment.

---

## ADR-002: Default Transport Protocol (Stdio Transport)

### Status
Accepted

### Context
The Model Context Protocol supports multiple communication transports: Standard I/O (`stdio`), Server-Sent Events (`SSE`), and HTTP. Local AI desktop tools (Claude Desktop, Cursor, local agent runners) primarily spawn MCP servers as child processes communicating over `stdin` and `stdout`.

### Decision
Implement **`StdioServerTransport`** as the default primary transport layer. Structure the MCP server initialization modularly so SSE / HTTP transports can be introduced later without refactoring domain logic.

### Consequences
- **Positive**:
  - Out-of-the-box compatibility with Claude Desktop and command-line LLM runners.
  - Zero network port binding conflicts or local firewall prompts.
  - Lifecycle is tied directly to the parent LLM process.
- **Negative**:
  - Logging must be strictly routed to `stderr` rather than `stdout`, as any arbitrary write to `stdout` corrupts the MCP JSON-RPC protocol stream.

---

## ADR-003: Direct Integration with OpenProject REST API v3

### Status
Accepted

### Context
OpenProject provides a comprehensive REST API v3 located at `/api/v3`. It uses HAL+JSON format and provides endpoints for projects, work packages, queries, types, statuses, users, and more.

### Decision
Directly integrate with OpenProject's native **REST API v3** using a lightweight HTTP client rather than relying on unmaintained third-party wrapper libraries.

### Consequences
- **Positive**:
  - Full compatibility with current and future OpenProject versions (12.x, 13.x, 14.x+).
  - No external library obsolescence risks.
  - Accurate mapping to OpenProject's official schema and capabilities.
- **Negative**:
  - We must implement and maintain custom HAL+JSON deserialization and filter encoding helpers.

---

## ADR-004: Authentication Strategy (API Key via HTTP Basic Auth)

### Status
Accepted

### Context
OpenProject REST API v3 supports multiple authentication mechanisms:
1. **API Key Authentication**: HTTP Basic Auth with fixed username `apikey` and the user's personal API token as the password (`Authorization: Basic base64(apikey:<api_key>)`).
2. **OAuth2**: Requires callback redirect servers and token refresh infrastructure.
3. **Session Cookie**: Unsuited for programmatic/MCP server access.

### Decision
Use **Personal API Key authentication via HTTP Basic Auth**. The API key and OpenProject base URL will be configured via environment variables (`OPENPROJECT_BASE_URL` and `OPENPROJECT_API_KEY`) or command-line parameters.

### Consequences
- **Positive**:
  - Zero interactive login friction: users generate a token once in OpenProject (`My Account > Access tokens`) and supply it.
  - Stateless and lightweight: no complex token refresh or OAuth flow required.
  - Operates strictly within the user's personal permissions.
- **Negative**:
  - If an API key is revoked or rotated in OpenProject, the environment variable must be updated.

---

## ADR-005: Read/Browse-First Phased Capability Delivery

### Status
Accepted

### Context
Users need to explore, inspect, and query their OpenProject workspace (projects, work packages, backlog items, statuses, queries) through LLMs. Introducing mutating operations (updating work packages, deleting items) early increases risk of unintended changes before browsing and schema representation are proven solid.

### Decision
Phase development with **Read/Browse-First scope**:
1. **Phase 1 (Browsing & Discovery)**: Read projects, work packages, saved queries, and taxonomy metadata (types, statuses, priorities, users).
2. **Phase 2 (Mutations & Authoring)**: Create/update work packages, add comments, log time entries.
3. **Phase 3 (Attachments & Resources)**: Inspect attachments and read wiki/documents.

### Consequences
- **Positive**:
  - Rapid delivery of high-value, safe tools for LLM reasoning and status summarization.
  - Minimizes risk of accidental writes during early adoption.
  - Establishes solid schemas and testing foundations for entities before building mutation actions.
- **Negative**:
  - Write capabilities are deferred to Phase 2.

---

## ADR-006: Zod for Input Schema Validation and Type Safety

### Status
Accepted

### Context
MCP tools require strict parameter schemas defined as JSON Schema for LLM function calling. We also need compile-time TypeScript types corresponding to these parameters.

### Decision
Use **Zod** to declare tool argument schemas. Use `@modelcontextprotocol/sdk` utilities (or Zod's JSON schema conversion) to generate the tool input schemas and infer TypeScript parameter types (`z.infer<typeof Schema>`).

### Consequences
- **Positive**:
  - Single source of truth for runtime validation and static TypeScript types.
  - Automatic error responses with detailed validation feedback if an LLM generates malformed inputs.
  - Cleaner tool definitions without manual JSON Schema writing.
- **Negative**:
  - Adds `zod` as a core runtime dependency (standard in TypeScript MCP servers).

---

## ADR-007: HAL+JSON Normalization for Token Efficiency

### Status
Accepted

### Context
OpenProject's HAL+JSON responses are deeply nested, containing verbose `_links` objects (self, schema, custom fields, update/delete action links) and metadata. Passing raw HAL+JSON directly to LLMs wastes token context and degrades reasoning performance.

### Decision
Implement a dedicated **HAL Normalizer** (`hal-parser.ts`) that extracts essential entity attributes, resolves human-readable titles/names from linked objects (such as status, priority, author, project), and produces concise, clean JSON payloads for the LLM.

### Consequences
- **Positive**:
  - Significant reduction in LLM token consumption (up to 60-80% fewer tokens per work package).
  - Clearer, unambiguous structures for LLMs to reason over and summarize.
  - Isolation of OpenProject HAL conventions to the client layer.
- **Negative**:
  - Requires maintaining the mapping logic as new entity fields are supported.

---

## ADR-008: Testing Strategy with Fixture-Driven HAL Payloads

### Status
Accepted

### Context
Testing against a live OpenProject instance in CI/CD is impractical due to setup complexity and network dependency. Unit and integration tests must run fast and reliably offline.

### Decision
Adopt a **fixture-driven test strategy**:
1. Capture representative HAL+JSON payloads from OpenProject API v3 (projects, work packages, queries, schema, error payloads) as JSON fixture files in `tests/fixtures/`.
2. Mock HTTP responses using MSW (Mock Service Worker) or Node's `undici` / `fetch` mock utilities.
3. Verify MCP tool registration, schema parsing, and client transformation against these fixtures.

### Consequences
- **Positive**:
  - Fast, completely offline, deterministic test suite.
  - Tests reflect real-world OpenProject API responses.
  - Safe regression detection when updating normalizers or tool handlers.
- **Negative**:
  - Fixtures must be periodically verified when targeting major new OpenProject versions.

---

## ADR-009: Target OpenProject 17 as Primary Runtime and Test Environment

### Status
Accepted

### Context
OpenProject 17 is the current major stable release, featuring optimized container images (`17-slim`, ~410MB), modern Rails 7.x foundations, updated API v3 behaviors, and streamlined dependency footprints.

### Decision
Target **OpenProject 17** (`openproject/openproject:17-slim`) for all containerized local development stacks, automated seeding scripts, and live integration testing environments.

### Consequences
- **Positive**:
  - Aligns MCP server features with the current active OpenProject release.
  - Much smaller docker image download footprint compared to older releases (~410MB vs ~865MB).
  - Ensured compatibility with the latest API v3 specifications and authentication mechanics.
- **Negative**:
  - Ensures we adhere to OpenProject 17's specific cache configuration and host name variables.

---

## ADR-010: Adopt Bun as Runtime, Package Manager, and Test Runner

### Status
Accepted (Supersedes ADR-001)

### Context
MCP servers are typically spawned by LLM desktop clients (Claude Desktop, Cursor, Antigravity) as child processes over `stdio`. Fast startup time, low memory footprint, zero compilation lag for TypeScript files, and integrated test runner ergonomics are vital for agentic development workflows.

Bun provides:
1. Native TypeScript and JSX execution without intermediate build steps or transpilers (`ts-node`, `esbuild`, `tsc`).
2. Extremely fast package management (`bun install` in sub-second speeds) with modern text-based `bun.lock`.
3. Built-in test runner (`bun test`, `bun:test`) eliminating external dependencies like Jest or Vitest.
4. Native environment variable loading (`.env`, `.env.local`) without needing `dotenv`.
5. High-performance native `fetch` and `Bun.file` APIs.

### Decision
Adopt **Bun** (>= 1.2 / 1.3) as the exclusive runtime, package manager, and test runner for `openproject-mcp`.

### Consequences
- **Positive**:
  - Immediate startup with zero transpile overhead: `bun run src/index.ts`.
  - Ultra-fast test execution: `bun test`.
  - Simpler dependency tree: no `dotenv`, `ts-node`, `vitest`, or `jest`.
  - Seamless developer experience matching Bun's project initialization conventions.
- **Negative**:
  - Requires the host machine to have Bun installed rather than traditional Node.js/npm.

---

## ADR-011: Configurable Read-Only Execution Mode

### Status
Accepted

### Context
When integrating MCP servers with LLMs, users and administrators require granular safety boundaries. In many scenarios (e.g., exploratory analysis, code reviews, status summaries, onboarding, or automated audit agents), users want to grant the LLM visibility into OpenProject projects, work packages, and queries without granting write permissions that could accidentally modify tickets or corrupt project state.

### Decision
Implement an explicit, configurable **Read-Only Mode**:
1. Enabled via the `OPENPROJECT_READ_ONLY=true` environment variable or `--read-only` command-line argument.
2. **Tool Manifest Level**: When read-only mode is active, mutating tools (Phase 2 write tools such as create/update work package) are entirely omitted from the `ListTools` response sent to the MCP client. The LLM only sees browsing and query tools.
3. **Execution Guard Level**: As defense-in-depth, the server's tool execution dispatcher checks the read-only flag before invoking any tool marked as mutating, immediately rejecting write attempts with `SERVER_READ_ONLY`.

### Consequences
- **Positive**:
  - Complete safety for users wanting strictly observational LLM capabilities.
  - Zero token waste exposing mutation tool definitions that the agent is forbidden from using.
  - Clean separation between queries and commands.
- **Negative**:
  - Tools must explicitly declare whether they are mutating or read-only during registration.

---

## ADR-012: Request-Scoped Context Architecture for Multi-User Concurrency & Security

### Status
Accepted

### Context
We want multiple users to interact with OpenProject via the MCP server concurrently, each using their own personal API key and receiving responses according to their own OpenProject permissions (RBAC).

Two architectural options were considered:
1. **Global Singleton Client**: Easy to write for single-user CLI scripts, but completely broken for concurrent users (race conditions, token overwriting, cross-user privilege escalation, and token leakage).
2. **Request-Scoped Context Pattern (`RequestContext` + `AsyncLocalStorage`)**: Every incoming request/connection carries or resolves an isolated `RequestContext` containing an ephemeral `OpenProjectClient` configured with that user's specific API credentials.

### Decision
Adopt the **Request-Scoped Context Architecture**:
1. **No Global State**: No singleton `OpenProjectClient` instance or mutable global API token will be maintained.
2. **Context Interface**:
   ```typescript
   export interface RequestContext {
     client: OpenProjectClient;
     isReadOnly: boolean;
     sessionId?: string;
     userId?: string;
   }
   ```
3. **Dual-Transport Compatibility**:
   - **Local Stdio Mode**: The process context initializes a single `RequestContext` from local environment variables or CLI flags, isolated at the OS process boundary.
   - **Shared Server (SSE / HTTP) Mode**: The connection handler extracts the user's API key from HTTP request headers (`Authorization: Basic ...` or `X-OpenProject-API-Key`), builds an ephemeral `RequestContext`, and wraps tool execution inside `requestContextStorage.run(context, fn)`.
4. **Stateless Services**: All domain services (`ProjectsService`, `WorkPackagesService`, etc.) are stateless function collections or classes that resolve the current user's client from `getRequestContext()`.

### Consequences
- **Positive**:
  - Eliminates cross-user token leaks and race conditions in concurrent multi-user environments.
  - Automatically respects OpenProject's per-user Role-Based Access Control (User A only sees User A's data).
  - Unifies local desktop (`stdio`) and remote shared (`sse`) implementations under a single domain codebase.
  - Tokens and client instances are ephemeral and garbage-collected with the request lifecycle.
- **Negative**:
  - Tool handlers must access their client via `getRequestContext()` rather than directly importing a static instance.

---

## ADR-013: Stdio Server Assembly & Stream Hygiene

### Status
Accepted

### Context
When running over the standard MCP stdio transport (`StdioServerTransport`), the child process's standard output (`stdout`) is strictly reserved for JSON-RPC framing and message payloads. Any unexpected output sent to `stdout` (such as debugging statements, logger banners, or third-party library logging) corrupts the protocol stream and immediately crashes or disconnects MCP client hosts.

### Decision
1. **Stdio Stream Isolation**: All diagnostics, lifecycle announcements, startup banners, error notices, and termination logs must strictly route to standard error (`stderr` / `console.error`).
2. **Server Factory Separation**: Keep the server definition (`src/server.ts`) separate and pure from the runtime CLI entrypoint (`src/index.ts`).
3. **Idempotent Signal Handling**: CLI signal traps (`SIGINT`, `SIGTERM`) implement an `isShuttingDown` guard to ensure clean, one-time server teardown without race conditions.

### Consequences
- **Positive**:
  - 100% protocol integrity across all MCP client hosts (Claude Desktop, Cursor, Antigravity CLI).
  - Clean error diagnostics visible to operators in client log panels via `stderr`.
- **Negative**:
  - Developers and agents must never use `console.log` in server or domain code.

---

## ADR-014: OpenProject OpenAPI Specification Discovery

### Status
Accepted

### Context
OpenProject REST API v3 provides dynamic, instance-specific OpenAPI 3.0 schema definitions at `/api/v3/openapi.json`. LLM agents and tooling benefit from discovering API capabilities, endpoints, and data schemas dynamically from the connected instance.

### Decision
Support OpenAPI 3.0 specification retrieval as an MCP tool (`openproject_get_openapi_spec`) and client capability, allowing agents to introspect the complete OpenProject API definition.

### Consequences
- **Positive**:
  - Enables dynamic tool generation, schema discovery, and self-documenting capabilities for LLM agents.
  - Automatically adapts to installed OpenProject plugins and API extensions on target instances.
- **Negative**:
  - Requires handling large JSON payloads efficiently when requesting full OpenAPI definitions.

---

## ADR-015: Docker Container Packaging and GitHub Actions CI/CD Pipeline

### Status
Accepted

### Context
Users and client LLM applications (such as Claude Desktop, Cursor, or containerized agents) require a lightweight, zero-dependency method to run `openproject-mcp` without manually installing Bun or local development dependencies. Furthermore, pull requests and releases require automated validation to guarantee that tests pass and container images are securely built and published to GitHub Container Registry (`ghcr.io`).

### Decision
1. **Runtime Base Image**: Adopt `oven/bun:1-slim` with a multi-stage Docker build. The builder stage installs production dependencies (`bun install --frozen-lockfile --production`), and the runner stage copies only production node_modules and application sources.
2. **Security & Permissions**: Run container execution under the unprivileged `bun` user (UID 1000). Exclude sensitive environment files (`.env*`), git records, and local tokens via `.dockerignore`.
3. **Multi-Architecture**: Build container images for both `linux/amd64` and `linux/arm64` via Docker Buildx and QEMU.
4. **Interactive Stdio Execution**: Configure container `ENTRYPOINT ["bun", "run", "src/index.ts"]` with standard I/O streaming, allowing runtime options (such as `--read-only`) to be appended directly.
5. **Continuous Integration**: Implement a two-stage GitHub Actions workflow (`.github/workflows/ci.yml`):
   - `test`: Executes `bun run typecheck` and `bun test` on PRs and main pushes.
   - `docker`: Builds multi-arch images with `type=gha` cache, publishing to `ghcr.io` on pushes to `main` and release tags (`v*.*.*`), while validating builds without push on pull requests.

### Consequences
- Provides seamless Docker execution for desktop and server MCP clients via `docker run -i --rm ghcr.io/<owner>/openproject-mcp:latest`.
- Prevents container build regressions through automated PR verification.
- Guarantees multi-architecture compatibility across Apple Silicon and x86_64 host machines.

---

## ADR-016: Hosted Remote MCP Server Architecture (HTTP/SSE Transport) & Multi-Tenant Credential Scoping

### Status
Accepted

### Context
`openproject-mcp` initially executed exclusively as a local child process over standard input/output (`stdio`). While ideal for individual developers running local tools like Claude Desktop or Cursor on their personal machines, team environments, shared hosting, and web agents require a remotely hosted MCP server instance accessible over standard network protocols.

Key requirements for hosted operation:
1. **Multi-Tenant Credential Scoping**: A single server process connects to a shared OpenProject base URL (`OPENPROJECT_BASE_URL`), but every connecting user/agent must use their own personal OpenProject API token. User credentials must never bleed across sessions or be retained in global mutable memory.
2. **Dual-Transport Entrypoint**: The server CLI must support both local stdio execution and hosted HTTP/SSE execution via configuration (`PORT`, `HOST_PORT` fallback, or `--port`).
3. **Flexible Authentication**: Clients must be able to authenticate via standard headers (`Authorization: Bearer <key>`, `X-OpenProject-Api-Key: <key>`) or query parameters (`?apiKey=<key>`) for SSE-compatible desktop and web clients.
4. **Health & Lifecycle Management**: Provide standardized `/health` endpoints and clean session eviction on client disconnect to prevent memory leaks.

### Decision
1. **HTTP/SSE Transport Engine**: Implement `src/http-server.ts` utilizing native `Bun.serve` and Web Streams for Server-Sent Events (`text/event-stream`).
2. **Credential Extraction Precedence**:
   - Priority 1: `Authorization: Bearer <token>`
   - Priority 2: `X-OpenProject-Api-Key: <token>`
   - Priority 3: `?apiKey=<token>` URL query parameter
   - Reject unauthenticated `/sse` requests immediately with HTTP 401 Unauthorized.
3. **Per-Connection Isolation**: For each `/sse` connection, allocate a unique `sessionId` and initialize an isolated `OpenProjectClient` and `McpServer` instance. Route tool calls and JSON-RPC dispatch via `runWithContext` using `AsyncLocalStorage`.
4. **Session Eviction**: Register connection abort and stream cancellation handlers (`req.signal.addEventListener("abort")` and `stream.cancel()`) that evict disconnected sessions from active memory.
5. **Container Deployment**: Provide `docker-compose.server.yml` with built-in `/health` probe checking `GET /health` every 30s.

### Consequences
- **Positive**:
  - Organizations can deploy a single shared `openproject-mcp` service without sharing API tokens.
  - Full compatibility with remote MCP client connections in Cursor, Claude Desktop, and autonomous agents.
  - Backward compatibility: when `PORT` is not set, stdio transport remains the default with zero overhead.
- **Negative**:
  - Requires network infrastructure (e.g. reverse proxy with TLS termination) in production to protect credentials in transit.
