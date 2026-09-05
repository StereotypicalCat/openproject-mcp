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


