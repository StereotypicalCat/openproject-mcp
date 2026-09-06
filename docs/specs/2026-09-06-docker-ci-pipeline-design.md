# Specification: Docker Packaging & GitHub Actions CI/CD Pipeline

## 1. Overview & Objectives

This specification defines the Docker containerization and continuous integration (CI/CD) pipeline for `openproject-mcp`. The goal is to produce an official, multi-platform Docker container image published to GitHub Container Registry (`ghcr.io`) whenever changes land on `main` or semantic release tags are pushed, while validating code health and container build integrity on every pull request.

### Primary Objectives
1. **Container Packaging**: Provide a lean, secure, multi-stage `Dockerfile` and `.dockerignore` targeting the official `oven/bun:1-slim` runtime.
2. **Multi-Architecture Support**: Build for both `linux/amd64` and `linux/arm64` using Docker Buildx and QEMU.
3. **Least Privilege Security**: Run container processes under the unprivileged `bun` user (UID/GID 1000) and ensure credentials (`.env*`, tokens) are never included in the image layers.
4. **CI/CD Automation**: Create a unified GitHub Actions workflow (`.github/workflows/ci.yml`) that runs type checking (`tsc --noEmit`), test suites (`bun test`), and multi-arch Docker image compilation.
5. **Publishing Strategy**: Publish images to GitHub Container Registry (`ghcr.io/<owner>/<repo>`) with `latest`, commit SHA (`sha-<hash>`), and semantic version tags (`vX.Y.Z`, `X.Y`), while verifying pull requests with build-only checks without pushing.
6. **Documentation**: Update `README.md` with Docker execution instructions and record an Architectural Decision Record in `docs/DECISIONS.md`.

---

## 2. Container Architecture & Packaging

### 2.1 Base Image & Runtime Strategy
- **Base Image**: `oven/bun:1-slim` (Debian Bookworm slim base with Bun v1.x).
- **Rationale**:
  - Official Bun Docker image maintained by Oven.
  - Includes glibc and essential CA certificates needed for HTTPS communication with OpenProject instances.
  - Slim footprint (~80-90 MB) compared to full OS images.
  - Provides a built-in unprivileged user `bun` (UID 1000, GID 1000).

### 2.2 Multi-Stage Dockerfile (`Dockerfile`)
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

### 2.3 Context Hygiene (`.dockerignore`)
The `.dockerignore` file prevents build context bloat and guarantees sensitive local files are excluded:
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

---

## 3. GitHub Actions CI/CD Pipeline (`.github/workflows/ci.yml`)

### 3.1 Pipeline Triggers & Permissions
- **Triggers**:
  - `push`: branches `[main]`, tags `['v*.*.*']`
  - `pull_request`: branches `[main]`
  - `workflow_dispatch`: manual execution
- **Permissions**:
  - `contents: read`
  - `packages: write` (for publishing container images to GHCR)

### 3.2 Pipeline Jobs

```mermaid
graph TD
    A[Trigger: Push / PR / Tag] --> B[Job 1: test]
    B --> C[Setup Bun 1.3.14]
    C --> D[bun install --frozen-lockfile]
    D --> E[bun run typecheck]
    E --> F[bun test]
    F --> G{All Tests Passed?}
    G -- Yes --> H[Job 2: docker]
    G -- No --> Z[Fail Pipeline]
    H --> I[Setup QEMU & Buildx]
    H --> J[Compute Docker Metadata & Tags]
    H --> K{Is PR?}
    K -- Yes --> L[Build Multi-Arch (amd64, arm64) with GHA Cache - Push=False]
    K -- No --> M[Login to GHCR with GITHUB_TOKEN]
    M --> N[Build & Push Multi-Arch (amd64, arm64) to GHCR]
```

#### Job 1: `test`
- **Environment**: `ubuntu-latest`
- **Steps**:
  1. `actions/checkout@v4`
  2. `oven-sh/setup-bun@v2` with `bun-version: 1.3.14`
  3. `bun install --frozen-lockfile`
  4. `bun run typecheck` (`tsc --noEmit`)
  5. `bun test` (all mock unit and integration tests execute; live container tests gracefully skip if environment variables are unset)

#### Job 2: `docker`
- **Depends on**: `test` (will not run if tests or typecheck fail)
- **Environment**: `ubuntu-latest`
- **Steps**:
  1. `actions/checkout@v4`
  2. `docker/setup-qemu-action@v3` (enables multi-arch emulation for `linux/amd64` and `linux/arm64`)
  3. `docker/setup-buildx-action@v3`
  4. `docker/metadata-action@v5`:
     - Image base: `ghcr.io/${{ github.repository }}`
     - Flavor: `latest=auto`
     - Tags:
       - `type=ref,event=branch`
       - `type=ref,event=pr`
       - `type=semver,pattern={{version}}`
       - `type=semver,pattern={{major}}.{{minor}}`
       - `type=sha,prefix=sha-`
       - `type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}`
  5. `docker/login-action@v3` (run only if `github.event_name != 'pull_request'`):
     - Registry: `ghcr.io`
     - Username: `${{ github.actor }}`
     - Password: `${{ secrets.GITHUB_TOKEN }}`
  6. `docker/build-push-action@v6`:
     - Context: `.`
     - File: `./Dockerfile`
     - Platforms: `linux/amd64,linux/arm64`
     - Push: `${{ github.event_name != 'pull_request' }}`
     - Tags: `${{ steps.meta.outputs.tags }}`
     - Labels: `${{ steps.meta.outputs.labels }}`
     - Cache from: `type=gha`
     - Cache to: `type=gha,mode=max`

---

## 4. Operational Usage

### 4.1 Running the Docker Image
Users can run the container image via interactive stdio transport:
```bash
docker run -i --rm \
  -e OPENPROJECT_BASE_URL="https://openproject.example.com" \
  -e OPENPROJECT_API_KEY="your-api-key" \
  ghcr.io/<owner>/openproject-mcp:latest
```

Running in read-only mode:
```bash
docker run -i --rm \
  -e OPENPROJECT_BASE_URL="https://openproject.example.com" \
  -e OPENPROJECT_API_KEY="your-api-key" \
  ghcr.io/<owner>/openproject-mcp:latest --read-only
```

### 4.2 MCP Client Configuration Example (Claude Desktop / Cursor)
```json
{
  "mcpServers": {
    "openproject": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e", "OPENPROJECT_BASE_URL=https://openproject.example.com",
        "-e", "OPENPROJECT_API_KEY=your-api-key",
        "ghcr.io/<owner>/openproject-mcp:latest"
      ]
    }
  }
}
```

---

## 5. Verification & Testing Plan

1. **Local Docker Build**: Run `docker build -t openproject-mcp:test .` to verify multi-stage build finishes with zero errors.
2. **Local Execution & Stdio Verification**:
   - Run container with test environment variables:
     ```bash
     docker run -i --rm \
       -e OPENPROJECT_BASE_URL="http://localhost:8080" \
       -e OPENPROJECT_API_KEY="test-token" \
       openproject-mcp:test --read-only
     ```
   - Verify that container starts as non-root user `bun`, logs `[openproject-mcp] Server started (readOnly=true)` to stderr, and keeps stdout clean for JSON-RPC messages.
3. **Workflow Syntax & Linting**:
   - Validate `.github/workflows/ci.yml` YAML syntax and structure.
4. **Documentation Check**:
   - Record ADR-015 in `docs/DECISIONS.md`.
   - Update `README.md` with Docker usage guide.
   - Update `docs/TODO.md` tracking the CI/CD pipeline completion.
