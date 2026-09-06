# Project Progress & Roadmap

> [!IMPORTANT]
> **CRITICAL AGENT POLICY**:
> **Never continue automatically to the next task or phase.**
> After finishing any individual task, milestone, or commit, the agent must **always stop and check in with the user**. Present what was completed, outline the next logical step, and await explicit user approval before proceeding.

---

## 1. Completed Tasks

- [x] **Agentic Development Guidelines & Infrastructure**
  - [x] Created [AGENTS.md](../AGENTS.md) defining architectural conventions, coding practices, and agent workflow.
  - [x] Created [CLAUDE.md](../CLAUDE.md) and [GEMINI.md](../GEMINI.md) pointing to [AGENTS.md](../AGENTS.md).
  - [x] Created [docs/ARCHITECTURE.md](ARCHITECTURE.md) documenting layers, data flow, tool specifications, and API specifics.
  - [x] Created [docs/DECISIONS.md](DECISIONS.md) establishing initial ADRs (stack, transport, auth, scoping, testing).
  - [x] Created root [.gitignore](../.gitignore) protecting credentials, cache, and IDE artifacts.

- [x] **OpenProject 17 Local Docker Stack & Seeding**
  - [x] Created [docker-compose.yml](../docker-compose.yml) configured for OpenProject 17 (`openproject/openproject:17-slim`), PostgreSQL 17, and Memcached.
  - [x] Created [.env.example](../.env.example) documenting all stack and MCP client environment variables.
  - [x] Created [scripts/seed-test-data.rb](../scripts/seed-test-data.rb) (Rails runner script) to:
    - Activate default admin user and remove password reset requirements.
    - Generate a live personal API token via `Token::API.create_and_return_value(admin)`.
    - Seed dedicated test project `mcp-test-project` (ID: 4).
    - Seed 4 custom work packages (IDs: 38-41) across Task, Bug, Feature types.
    - Seed saved query `MCP Active Tasks` (ID: 30).
  - [x] Created [scripts/seed.sh](../scripts/seed.sh) orchestrating health checks and automated writing to `.env.test` and `.env.local`.
  - [x] Created lifecycle scripts [scripts/start.sh](../scripts/start.sh) and [scripts/stop.sh](../scripts/stop.sh).
  - [x] Verified live container execution and validated HTTP 200 API v3 access (`/api/v3/projects`) with generated token.
  - [x] Recorded [ADR-009](DECISIONS.md#adr-009-target-openproject-17-as-primary-runtime-and-test-environment) targeting OpenProject 17.

- [x] **Bun Runtime Migration & Tooling**
  - [x] Switched project runtime from Node.js to Bun (v1.3.14).
  - [x] Created [package.json](../package.json) with `@modelcontextprotocol/sdk` and `zod`.
  - [x] Created [tsconfig.json](../tsconfig.json) with Bun bundler settings and strict typing.
  - [x] Generated [bun.lock](../bun.lock).
  - [x] Added [src/index.ts](../src/index.ts) entrypoint stub and [tests/smoke.test.ts](../tests/smoke.test.ts) using `bun:test`.
  - [x] Updated [AGENTS.md](../AGENTS.md), [CLAUDE.md](../CLAUDE.md), and [GEMINI.md](../GEMINI.md) with Bun init rules.
  - [x] Recorded [ADR-010](DECISIONS.md#adr-010-adopt-bun-as-runtime-package-manager-and-test-runner) adopting Bun.
  - [x] Updated [README.md](../README.md) with Bun prerequisites and quickstart commands.

---

## 2. Next Up (Phase 1: Read/Browse Implementation)

- [x] **Task 1: OpenProject REST API v3 Client Layer**
  - [x] Implement `src/config/index.ts` to parse and validate `OPENPROJECT_BASE_URL`, `OPENPROJECT_API_KEY`, and `OPENPROJECT_READ_ONLY` (or `--read-only`) via Zod.
  - [x] Implement `src/context.ts` providing `RequestContext` interface and `AsyncLocalStorage` scoping (`getRequestContext`, `runWithContext`) for concurrent multi-user safety.
  - [x] Implement `src/client/api-client.ts` with native `fetch`, HTTP Basic Auth injection, error normalization, and rate/timeout handling.
  - [x] Implement `src/client/hal-parser.ts` to unpack HAL+JSON (`_links`, `_embedded`) into clean, token-efficient JSON models.
  - [x] Implement `src/client/filter-builder.ts` to translate LLM-friendly filter arguments into OpenProject's JSON filter syntax.
  - [x] Add unit tests in `tests/client.test.ts` verifying authentication headers, response parsing, and error sanitization against live container.

- [x] **Task 2: Domain Services**
  - [x] Implement `src/services/helper.ts` (`resolveClient` for ambient `RequestContext` resolution).
  - [x] Implement `src/services/projects.ts` (`listProjects`, `getProject`, `getProjectSchema`).
  - [x] Implement `src/services/work-packages.ts` (`listWorkPackages`, `getWorkPackage`, `searchWorkPackages`).
  - [x] Implement `src/services/queries.ts` (`listQueries`, `getQuery`, `getQueryResults`).
  - [x] Implement `src/services/metadata.ts` (`listStatuses`, `listTypes`, `listPriorities`, `listUsers`).
  - [x] Implement `src/services/openapi.ts` (`getOpenApiSpec` with in-memory caching, summary mode, path endpoint lookup, tag filtering, schema inspection).
  - [x] Add service tests in `tests/services.test.ts` (unit tests and live container integration suite passing).

- [x] **Task 3: MCP Tool Definitions & Schema Registration**
  - [x] Define Zod schemas and register tools in `src/tools/`:
    - [x] `openproject_list_projects`
    - [x] `openproject_get_project`
    - [x] `openproject_list_work_packages`
    - [x] `openproject_get_work_package`
    - [x] `openproject_list_queries`
    - [x] `openproject_get_query`
    - [x] `openproject_list_types`
    - [x] `openproject_list_statuses`
    - [x] `openproject_list_priorities`
    - [x] `openproject_list_users`
    - [x] `openproject_get_openapi_spec`

- [x] **Task 4: MCP Stdio Server Assembly & Integration**
  - [x] Wire domain tools into `@modelcontextprotocol/sdk` Server using `StdioServerTransport` in `src/server.ts` and `src/index.ts`.
  - [x] Implement read-only mode tool filtering (omits mutating tools when `readOnly` is enabled) and execution guard (`SERVER_READ_ONLY`).
  - [x] Ensure all logging is strictly redirected to `stderr`.
  - [x] Add end-to-end integration tests in `tests/mcp-server.test.ts` verifying tool calling against the running OpenProject 17 instance.
  - [x] Add read-only mode verification tests in `tests/read-only.test.ts`.

- [x] **Task 5: OpenAPI Introspection Tool & Service**
  - [x] Implement `src/services/openapi.ts` with in-memory caching, multi-mode queries (summary, path, tag, schema), and ambient client resolution.
  - [x] Implement `src/tools/openapi.ts` registering `openproject_get_openapi_spec` (`readOnly: true`) into `allTools` (bringing tool count to 11).
  - [x] Add comprehensive test suite in `tests/openapi.test.ts` covering service methods, MCP client execution, error handling, and live OpenProject 17 container integration.
  - [x] Update suite regressions and assertions across all test suites (`tests/tools.test.ts`, `tests/read-only.test.ts`, `tests/mcp-server.test.ts`).

- [x] **Task 6: Docker Container Packaging & CI/CD Pipeline**
  - [x] Created multi-stage [Dockerfile](../Dockerfile) using `oven/bun:1-slim` builder and unprivileged `bun` user runner.
  - [x] Created [.dockerignore](../.dockerignore) excluding secrets, local dependencies, test files, and docs from build context.
  - [x] Implemented GitHub Actions CI workflow [.github/workflows/ci.yml](../.github/workflows/ci.yml) with automated type checking, testing, and multi-arch Docker image publishing (`linux/amd64`, `linux/arm64`) to `ghcr.io`.
  - [x] Added automated test coverage in [tests/docker.test.ts](../tests/docker.test.ts) and [tests/ci-workflow.test.ts](../tests/ci-workflow.test.ts).
  - [x] Recorded [ADR-015](DECISIONS.md#adr-015-docker-container-packaging-and-github-actions-cicd-pipeline).
  - [x] Updated [README.md](../README.md) with Docker Quickstart, read-only mode instructions, and client integration settings (Claude Desktop & Cursor).

- [x] **Task 7: Hosted Remote MCP Server (HTTP/SSE Transport) & Multi-Tenant Credential Scoping**
  - [x] Extend configuration loader with `port` and `host` options (`src/config/index.ts`, `tests/config.test.ts`).
  - [x] Implement hosted HTTP/SSE MCP server with `Bun.serve` and Web Streams SSE (`src/http-server.ts`, `tests/http-server.test.ts`).
  - [x] Implement credential extraction hierarchy (`Authorization: Bearer`, `X-OpenProject-Api-Key`, `?apiKey=`) with 401 unauthorized rejection.
  - [x] Implement per-session client isolation and `runWithContext` dynamic scoping.
  - [x] Wire dual-transport execution in CLI entrypoint (`src/index.ts`).
  - [x] Create production `docker-compose.server.yml` with `/health` check probe.
  - [x] Record [ADR-016](DECISIONS.md#adr-016-hosted-remote-mcp-server-architecture-httpsse-transport--multi-tenant-credential-scoping).
  - [x] Update documentation with hosted deployment guide and remote client setups for Cursor and Claude Desktop in [README.md](../README.md).

- [x] **Task 8: OpenAPI 3.1.0 Specification & REST Tool Execution Bridge**
  - [x] Implement dynamic OpenAPI specification generator `src/openapi-spec.ts`.
  - [x] Expose `GET /openapi.json` and `GET /swagger.json` in `src/http-server.ts`.
  - [x] Expose REST tool execution endpoint `POST /api/tools/:toolName` with Zod parameter validation and `RequestContext` execution.
  - [x] Add automated test coverage in `tests/http-server.test.ts`.
  - [x] Record [ADR-017](DECISIONS.md#adr-017-openapi-310-specification--rest-tool-execution-bridge-for-openapi-clients) in `docs/DECISIONS.md`.
  - [x] Document OpenAPI connection mode and server endpoints reference table in [README.md](../README.md).

---

## 3. Backlog & Future Phases

- [x] **Phase 4: Remote Transport (Completed)**
  - [x] Add SSE (Server-Sent Events) transport option for remote deployments.
  - [x] Multi-tenant credential scoping with per-session isolation.
- [ ] **Phase 2: Mutating Operations**
  - [ ] Create work package tool (`openproject_create_work_package`).
  - [ ] Update work package tool (`openproject_update_work_package`).
  - [ ] Add comments / activities to work packages.
  - [ ] Time logging tool (`openproject_log_time`).
- [ ] **Phase 3: Attachments & Documents**
  - [ ] Inspect and download attachment resources.
  - [ ] Wiki pages and project documents browsing.
