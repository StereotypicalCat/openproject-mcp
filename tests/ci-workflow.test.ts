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
