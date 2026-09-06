# Docker Packaging & GitHub Actions CI/CD Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package `openproject-mcp` into an official, multi-platform Docker container image and build an automated GitHub Actions CI/CD pipeline that runs tests, builds multi-arch container images (`linux/amd64`, `linux/arm64`), and publishes them to GitHub Container Registry (`ghcr.io`).

**Architecture:** A multi-stage `Dockerfile` based on `oven/bun:1-slim` installs production dependencies in a builder stage, copies them into a minimal runner stage running as non-root user `bun`, and executes `src/index.ts` over stdio. A unified GitHub Actions workflow `.github/workflows/ci.yml` coordinates testing (`bun run typecheck`, `bun test`) with multi-arch Docker image compilation via QEMU and Buildx, publishing to GHCR on main branch commits and release tags.

**Tech Stack:** Docker, Bun (v1.3.14), GitHub Actions (`setup-bun`, `setup-qemu`, `setup-buildx`, `metadata-action`, `login-action`, `build-push-action`), GHCR.

**Spec:** `docs/specs/2026-09-06-docker-ci-pipeline-design.md`

## Global Constraints

- Runtime & Package Manager: Bun (>= 1.2 / 1.3), `bun test` for test execution.
- Base Container Image: `oven/bun:1-slim` with multi-stage build and unprivileged user `bun` (UID 1000).
- Transport: Interactive stdio execution (`ENTRYPOINT ["bun", "run", "src/index.ts"]`), allowing CLI flags like `--read-only` to be passed directly.
- Context Hygiene: `.dockerignore` must exclude `.env*`, `node_modules`, `tests`, `docs`, `scripts`, `.git`, and temporary files.
- CI Workflow: Single workflow file `.github/workflows/ci.yml` with `test` and `docker` jobs (`needs: test`).
- CI Platforms: Multi-arch `linux/amd64,linux/arm64` with GitHub Actions cache (`type=gha`).
- Stdio stream hygiene: Container stdout strictly reserved for JSON-RPC, diagnostics sent to stderr.

---

### Task 1: Multi-Stage Dockerfile & .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `tests/docker.test.ts`

**Interfaces:**
- Consumes: `package.json`, `bun.lock`, `tsconfig.json`, `src/index.ts`
- Produces: Production Docker image artifact and local build verification test suite

- [ ] **Step 1: Write the failing test in `tests/docker.test.ts`**

```typescript
import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT_DIR = resolve(import.meta.dir, "..");

describe("Docker Container Packaging", () => {
  test("Dockerfile exists and defines multi-stage build with non-root user", () => {
    const dockerfilePath = resolve(ROOT_DIR, "Dockerfile");
    expect(existsSync(dockerfilePath)).toBe(true);

    const content = readFileSync(dockerfilePath, "utf-8");
    expect(content).toContain("FROM oven/bun:1-slim AS builder");
    expect(content).toContain("FROM oven/bun:1-slim AS runner");
    expect(content).toContain("bun install --frozen-lockfile --production");
    expect(content).toContain("USER bun");
    expect(content).toContain('ENTRYPOINT ["bun", "run", "src/index.ts"]');
  });

  test(".dockerignore exists and excludes sensitive and unnecessary files", () => {
    const ignorePath = resolve(ROOT_DIR, ".dockerignore");
    expect(existsSync(ignorePath)).toBe(true);

    const content = readFileSync(ignorePath, "utf-8");
    expect(content).toContain("node_modules");
    expect(content).toContain(".env*");
    expect(content).toContain(".git");
    expect(content).toContain("tests");
    expect(content).toContain("docs");
    expect(content).toContain("scripts");
  });

  test("Docker image builds and starts up cleanly in container", async () => {
    // Check if docker daemon is available in test environment
    const proc = Bun.spawn(["which", "docker"], { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      console.warn("Docker CLI not available, skipping container build execution test");
      return;
    }

    // Build test image
    const buildProc = Bun.spawn(["docker", "build", "-t", "openproject-mcp:test", "."], {
      cwd: ROOT_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });
    const buildExit = await buildProc.exited;
    expect(buildExit).toBe(0);

    // Run container with test env and check stderr banner
    const runProc = Bun.spawn(
      [
        "docker",
        "run",
        "-i",
        "--rm",
        "-e",
        "OPENPROJECT_BASE_URL=http://localhost:8080",
        "-e",
        "OPENPROJECT_API_KEY=test-token",
        "openproject-mcp:test",
        "--read-only",
      ],
      {
        cwd: ROOT_DIR,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    // Give it 1.5s to start and write banner to stderr
    await Bun.sleep(1500);
    runProc.kill();
    await runProc.exited;

    const stderrText = await new Response(runProc.stderr).text();
    expect(stderrText).toContain("[openproject-mcp] Server started (readOnly=true)");
  }, 60000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/docker.test.ts`
Expected: FAIL because `Dockerfile` and `.dockerignore` do not exist yet.

- [ ] **Step 3: Implement `Dockerfile` and `.dockerignore`**

Create `Dockerfile`:
```dockerfile
# Stage 1: Dependency resolution and production prune
FROM oven/bun:1-slim AS builder
WORKDIR /app

# Copy dependency manifests
COPY package.json bun.lock ./

# Install production dependencies only with strict lockfile
RUN bun install --frozen-lockfile --production

# Stage 2: Minimal runtime image
FROM oven/bun:1-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy installed production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application configuration and source code
COPY package.json tsconfig.json ./
COPY src ./src

# Set ownership and drop root privileges
RUN chown -R bun:bun /app
USER bun

# Standard MCP stdio communication
ENTRYPOINT ["bun", "run", "src/index.ts"]
```

Create `.dockerignore`:
```
node_modules
.git
.github
.env*
coverage
tests
docs
scripts
.superpowers
*.log
*.md
docker-compose.yml
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/docker.test.ts`
Expected: PASS (all 3 tests pass including local docker build and container execution).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore tests/docker.test.ts
git commit -m "feat(docker): add multi-stage Dockerfile and .dockerignore"
```

---

### Task 2: GitHub Actions CI/CD Pipeline Workflow

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `tests/ci-workflow.test.ts`

**Interfaces:**
- Consumes: `Dockerfile`, `.dockerignore`, `package.json`, `tests/`
- Produces: Automated GitHub Actions CI workflow triggered on PRs, main pushes, tags, and workflow_dispatch

- [ ] **Step 1: Write the failing test in `tests/ci-workflow.test.ts`**

```typescript
import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT_DIR = resolve(import.meta.dir, "..");
const WORKFLOW_PATH = resolve(ROOT_DIR, ".github/workflows/ci.yml");

describe("GitHub Actions CI Workflow", () => {
  test("ci.yml exists and has proper triggers and permissions", () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);

    const content = readFileSync(WORKFLOW_PATH, "utf-8");

    // Triggers
    expect(content).toContain("pull_request:");
    expect(content).toContain("push:");
    expect(content).toContain("workflow_dispatch:");
    expect(content).toContain("- main");
    expect(content).toContain("- 'v*.*.*'");

    // Permissions
    expect(content).toContain("permissions:");
    expect(content).toContain("contents: read");
    expect(content).toContain("packages: write");
  });

  test("ci.yml defines test job with Bun 1.3.14 and strict checks", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");

    expect(content).toContain("test:");
    expect(content).toContain("runs-on: ubuntu-latest");
    expect(content).toContain("oven-sh/setup-bun@v2");
    expect(content).toContain("bun-version: 1.3.14");
    expect(content).toContain("bun install --frozen-lockfile");
    expect(content).toContain("bun run typecheck");
    expect(content).toContain("bun test");
  });

  test("ci.yml defines docker job with multi-arch buildx and ghcr publishing", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");

    expect(content).toContain("docker:");
    expect(content).toContain("needs: test");
    expect(content).toContain("docker/setup-qemu-action@v3");
    expect(content).toContain("docker/setup-buildx-action@v3");
    expect(content).toContain("docker/metadata-action@v5");
    expect(content).toContain("ghcr.io/${{ github.repository }}");
    expect(content).toContain("docker/login-action@v3");
    expect(content).toContain("registry: ghcr.io");
    expect(content).toContain("docker/build-push-action@v6");
    expect(content).toContain("platforms: linux/amd64,linux/arm64");
    expect(content).toContain("push: ${{ github.event_name != 'pull_request' }}");
    expect(content).toContain("type=gha");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ci-workflow.test.ts`
Expected: FAIL because `.github/workflows/ci.yml` does not exist yet.

- [ ] **Step 3: Implement `.github/workflows/ci.yml`**

Create `.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches:
      - main
    tags:
      - 'v*.*.*'
  pull_request:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: read
  packages: write

jobs:
  test:
    name: Test & Lint
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Type check
        run: bun run typecheck

      - name: Run test suite
        run: bun test

  docker:
    name: Build & Publish Docker Image
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          flavor: |
            latest=auto
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,prefix=sha-
            type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}

      - name: Log in to GitHub Container Registry
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push Docker image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          platforms: linux/amd64,linux/arm64
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/ci-workflow.test.ts`
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml tests/ci-workflow.test.ts
git commit -m "ci: create GitHub Actions workflow for testing and multi-arch Docker publishing"
```

---

### Task 3: Documentation, ADR-015 & Roadmap Tracking

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/TODO.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Docker packaging artifacts and CI workflow
- Produces: Updated architectural records, user documentation, and project roadmap tracking

- [ ] **Step 1: Add ADR-015 to `docs/DECISIONS.md`**

Append ADR-015 to `docs/DECISIONS.md`:
```markdown
## ADR-015: Docker Container Packaging and GitHub Actions CI/CD Pipeline

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
```

- [ ] **Step 2: Update `README.md` with Docker Quickstart**

Add a Docker section in `README.md` explaining:
- How to pull and run via `docker run -i --rm`
- Environment variables (`OPENPROJECT_BASE_URL`, `OPENPROJECT_API_KEY`)
- How to enable `--read-only` mode
- Configuration snippets for Claude Desktop and Cursor

- [ ] **Step 3: Update `docs/TODO.md`**

Record the Docker Container Packaging and GitHub Actions CI/CD Pipeline under completed tasks in `docs/TODO.md`.

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: PASS (all test files pass, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add docs/DECISIONS.md docs/TODO.md README.md
git commit -m "docs: record ADR-015, update README with Docker usage, and update TODO.md"
```
