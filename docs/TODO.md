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

- [ ] **Task 1: OpenProject REST API v3 Client Layer**
  - [ ] Implement `src/config/index.ts` to parse and validate `OPENPROJECT_BASE_URL`, `OPENPROJECT_API_KEY`, and `OPENPROJECT_READ_ONLY` (or `--read-only`) via Zod.
  - [ ] Implement `src/client/api-client.ts` with native `fetch`, HTTP Basic Auth injection, error normalization, and rate/timeout handling.
  - [ ] Implement `src/client/hal-parser.ts` to unpack HAL+JSON (`_links`, `_embedded`) into clean, token-efficient JSON models.
  - [ ] Implement `src/client/filter-builder.ts` to translate LLM-friendly filter arguments into OpenProject's JSON filter syntax.
  - [ ] Add unit tests in `tests/client.test.ts` verifying authentication headers, response parsing, and error sanitization against live container.

- [ ] **Task 2: Domain Services**
  - [ ] Implement `src/services/projects.ts` (`listProjects`, `getProject`).
  - [ ] Implement `src/services/work-packages.ts` (`listWorkPackages`, `getWorkPackage`, `searchWorkPackages`).
  - [ ] Implement `src/services/queries.ts` (`listQueries`, `getQuery`).
  - [ ] Implement `src/services/metadata.ts` (`listStatuses`, `listTypes`, `listPriorities`, `listUsers`).
  - [ ] Add service tests in `tests/services.test.ts`.

- [ ] **Task 3: MCP Tool Definitions & Schema Registration**
  - [ ] Define Zod schemas and register tools in `src/tools/`:
    - `openproject_list_projects`
    - `openproject_get_project`
    - `openproject_list_work_packages`
    - `openproject_get_work_package`
    - `openproject_list_queries`
    - `openproject_get_query`
    - `openproject_list_types`
    - `openproject_list_statuses`
    - `openproject_list_priorities`
    - `openproject_list_users`

- [ ] **Task 4: MCP Stdio Server Assembly & Integration**
  - [ ] Wire domain tools into `@modelcontextprotocol/sdk` Server using `StdioServerTransport` in `src/server.ts` and `src/index.ts`.
  - [ ] Implement read-only mode tool filtering (omits mutating tools when `readOnly` is enabled) and execution guard (`SERVER_READ_ONLY`).
  - [ ] Ensure all logging is strictly redirected to `stderr`.
  - [ ] Add end-to-end integration tests in `tests/mcp-server.test.ts` verifying tool calling against the running OpenProject 17 instance.
  - [ ] Add read-only mode verification tests in `tests/read-only.test.ts`.

---

## 3. Backlog & Future Phases

- [ ] **Phase 2: Mutating Operations**
  - [ ] Create work package tool (`openproject_create_work_package`).
  - [ ] Update work package tool (`openproject_update_work_package`).
  - [ ] Add comments / activities to work packages.
  - [ ] Time logging tool (`openproject_log_time`).
- [ ] **Phase 3: Attachments & Documents**
  - [ ] Inspect and download attachment resources.
  - [ ] Wiki pages and project documents browsing.
- [ ] **Phase 4: Remote Transport**
  - [ ] Add SSE (Server-Sent Events) transport option for remote deployments.
