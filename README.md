# openproject-mcp

`openproject-mcp` is a Model Context Protocol (MCP) server that connects AI assistants (such as Claude Desktop, Cursor, and Antigravity) to [OpenProject](https://github.com/opf/openproject) via OpenProject's REST API v3.

It allows agents to browse, query, and reason about OpenProject workspaces using personal API keys over standard MCP transports (stdio).

---

## Features

- **Project Discovery**: List accessible projects, inspect hierarchies, and retrieve project details.
- **Work Package Browsing**: Query work packages with status, type, and custom filters; inspect work package details and relationships.
- **Saved Queries (Views)**: Discover and execute saved project and global queries.
- **Taxonomies & Metadata**: Query work package types (Tasks, Bugs, Features), statuses, priorities, and users to enable structured agent reasoning.
- **HAL+JSON Normalization**: Converts OpenProject's verbose HAL+JSON representations into concise, token-efficient structures.
- **Secure Authentication**: Uses OpenProject Personal API tokens via HTTP Basic Auth (`apikey:<token>`) with zero credential storage inside the codebase.

---

## Project Documentation

- [AGENTS.md](AGENTS.md): Guidelines, coding standards, and workflow instructions for AI coding agents.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): System architecture, layer diagrams, tool schemas, and technical design.
- [docs/DECISIONS.md](docs/DECISIONS.md): Architectural Decision Records (ADRs) documenting stack choices, protocols, and designs.

---

## Quickstart: Local OpenProject Test Stack

A complete OpenProject 17 environment with PostgreSQL 17 and Memcached is included via Docker Compose for local testing and agentic validation.

### Prerequisites

- Docker and Docker Compose (v2+)
- [Bun](https://bun.sh) (>= 1.2 / 1.3)

### 1. Start the Environment & Seed Data

Run the start script to boot the containers, wait for health checks, seed sample data, and generate a personal API token:

```bash
./scripts/start.sh
```

Or step-by-step:

```bash
# 1. Start the Docker Compose stack in the background
docker compose up -d

# 2. Wait for health checks, seed test data, and generate credentials
./scripts/seed.sh
```

This will automatically create `.env.test` and `.env.local` containing the generated credentials:

```env
OPENPROJECT_BASE_URL=http://localhost:8080
OPENPROJECT_API_KEY=opapi-...
OPENPROJECT_TEST_PROJECT=mcp-test-project
```

### 2. Verify OpenProject is Running

Once seeded, OpenProject is accessible at [http://localhost:8080](http://localhost:8080):
- **Username**: `admin`
- **Password**: `admin12345678`

You can verify the API v3 connection directly using `curl`:

```bash
curl -u "apikey:$(grep OPENPROJECT_API_KEY .env.test | cut -d= -f2)" \
  http://localhost:8080/api/v3/projects
```

### 3. Stop the Stack

```bash
./scripts/stop.sh
# or
docker compose down
```

To also remove database and asset volumes:

```bash
docker compose down -v
```

---

## MCP Server Development (Bun)

Install project dependencies:

```bash
bun install
```

Start the MCP server over stdio:

```bash
bun run src/index.ts
```

Run test suite:

```bash
bun test
```

Type-check:

```bash
bun run typecheck
```

---

## Configuration

The MCP server accepts configuration through environment variables or a `.env` file:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `OPENPROJECT_BASE_URL` | Base URL of the OpenProject instance | `http://localhost:8080` |
| `OPENPROJECT_API_KEY` | Personal API token (created under My Account > Access tokens) | - |
| `PORT` | Local port for the Docker Compose web container | `8080` |
| `TAG` | OpenProject container image tag | `17-slim` |
| `POSTGRES_VERSION` | PostgreSQL container image tag | `17` |

---

## Development Roadmap

- **Phase 1 (Current)**: Read-only browsing tools for projects, work packages, queries, and taxonomies.
- **Phase 2**: Mutating operations (create/update work packages, add comments, log time).
- **Phase 3**: Attachment reading and document resources.
- **Phase 4**: SSE / Stream transport for remote server deployments.

---

## License

GNU General Public License v3.0 (aligned with OpenProject Community Edition).