# Agent Guidelines for openproject-mcp

Welcome to the `openproject-mcp` project. This document defines operating principles, architectural conventions, coding practices, and workflow expectations for AI agents collaborating on this codebase.

## 1. Project Overview

`openproject-mcp` is a Model Context Protocol (MCP) server that acts as an intelligent bridge to [OpenProject](https://github.com/opf/openproject). It enables LLM agents and clients (e.g., Claude Desktop, Antigravity, Cursor) to browse, query, and interact with OpenProject instances using user API keys via OpenProject's REST API v3.

### Primary Objectives
- Expose OpenProject projects, work packages, queries, users, and taxonomies as MCP tools and resources.
- Provide secure, transparent authentication via OpenProject API tokens.
- Handle OpenProject's HAL+JSON schema and complex query filter syntax gracefully.
- Ensure lightweight, resilient runtime execution over standard MCP transports (stdio).

---

## 2. General Principles for Agents

1. **Check Documentation First**: Before proposing or executing architectural changes, consult [docs/ARCHITECTURE.md](file:///home/user/openproject-mcp/docs/ARCHITECTURE.md) and [docs/DECISIONS.md](file:///home/user/openproject-mcp/docs/DECISIONS.md).
2. **Document Architectural Decisions**: If a change alters the design, dependencies, or interfaces, record a new entry or update existing records in [docs/DECISIONS.md](file:///home/user/openproject-mcp/docs/DECISIONS.md).
3. **Preserve Repository Integrity**: Do not delete existing comments, licenses, or configuration files unless specifically tasked with refactoring them.
4. **Security by Design**: Never log or commit credentials, API tokens, or session secrets.
5. **Never Continue Automatically**: Never proceed automatically to the next task or phase. Always stop and check in with the user after completing a task, outline the next logical step, and await explicit approval.
6. **Maintain Task Tracking**: Keep [docs/TODO.md](file:///home/user/openproject-mcp/docs/TODO.md) updated with completed items and next steps after every milestone.

---

## 3. Technology Stack & Coding Standards

### Stack
- **Runtime & Package Manager**: **Bun** (>= 1.2 / 1.3).
  - Default to using Bun instead of Node.js.
  - Use `bun <file>` instead of `node <file>` or `ts-node <file>`.
  - Use `bun test` instead of `jest` or `vitest` (using `import { test, expect, describe } from "bun:test"`).
  - Use `bun add` / `bun install` instead of `npm install`, `pnpm`, or `yarn`.
  - Use `bun run <script>` instead of `npm run <script>`.
  - Use `bunx <package>` instead of `npx <package>`.
  - Bun automatically loads `.env` and `.env.local`, so do not introduce external packages like `dotenv`.
  - Prefer `Bun.file` over `node:fs` for reading and writing files.
- **Language**: TypeScript (running natively on Bun with ESNext target, `bundler` module resolution, strict mode).
- **MCP Framework**: Official `@modelcontextprotocol/sdk`.
- **Validation**: `zod` for input schema validation and TypeScript inference.
- **HTTP Client**: Native `fetch` (high-performance built-in implementation in Bun).
- **Testing**: `bun:test` with fixture-based mocking for HAL+JSON API responses.

### Code Style
- **TypeScript**: Strict type checking enabled (`strict: true` in `tsconfig.json`). Avoid `any` - use `unknown` with type guards or explicit Zod schemas.
- **Modularity**: Separate transport/MCP protocol concerns from OpenProject domain logic and HTTP client handling.
- **Naming Conventions**:
  - Files and directories: `kebab-case` (e.g., `openproject-client.ts`, `work-packages.ts`).
  - Types and Interfaces: `PascalCase` (e.g., `OpenProjectConfig`, `WorkPackageResource`).
  - Functions and variables: `camelCase` (e.g., `fetchWorkPackage`, `projectIdentifier`).
  - Constants: `UPPER_SNAKE_CASE` (e.g., `DEFAULT_PAGE_SIZE`, `API_V3_PREFIX`).
  - MCP Tool Names: `snake_case` prefixed with domain (e.g., `openproject_list_projects`, `openproject_get_work_package`).

---

## 4. OpenProject API Integration Guidelines

### Authentication
- OpenProject REST API v3 uses HTTP Basic Authentication for API keys:
  - Username: `apikey`
  - Password: `<USER_API_KEY>`
  - Header format: `Authorization: Basic base64(apikey:<USER_API_KEY>)`
- Base URL format: `<protocol>://<host>[:port]` (e.g., `https://openproject.example.com`). The API v3 root is at `/api/v3`.

### HAL+JSON Format
- OpenProject responses use HAL+JSON format (`_links`, `_embedded`).
- Agents must ensure parsing utilities extract canonical identifiers and friendly representations for LLM consumption rather than dumping raw deep HAL trees when not needed.

### Filters and Pagination
- OpenProject API v3 filters use JSON string parameters (e.g., `filters=[{"status_id":{"operator":"o","values":[]}}]`).
- Tool handlers should accept clean, human/LLM-friendly arguments (e.g., `status: "open"`, `projectId: 12`) and translate them into OpenProject's filter syntax.

---

## 5. Security & Safety

- **Secrets Management**: Read `OPENPROJECT_BASE_URL` and `OPENPROJECT_API_KEY` from environment variables. Never hardcode credentials in tests, scripts, or examples.
- **Input Validation**: All tool parameters must be validated via Zod schemas before being used in HTTP requests.
- **Safe Error Propagation**: Sanitize error messages returned to the MCP client. Never leak authorization headers or system paths in tool error responses.
- **Read-Only Mode Enforcement**: Support `OPENPROJECT_READ_ONLY=true` and `--read-only`. When active, mutating tools must not be registered in the MCP tool manifest and must be rejected by execution guards with `SERVER_READ_ONLY`.

---

## 6. Development Workflow for Agents

1. **Understand Task Scope**: Read requirements and check existing code and docs.
2. **Test-Driven or Verification-Driven**: When writing or updating tools, verify against mock OpenProject API responses.
3. **Update Docs**: Keep `docs/ARCHITECTURE.md` and `docs/DECISIONS.md` synchronized with the actual codebase.
4. **Clean Commits**: Make focused, atomic commits with descriptive messages following Conventional Commits (e.g., `feat:`, `fix:`, `docs:`, `refactor:`).
