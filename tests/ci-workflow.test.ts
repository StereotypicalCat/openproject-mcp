import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT_DIR = resolve(import.meta.dir, "..");
const WORKFLOW_PATH = resolve(ROOT_DIR, ".gitea/workflows/ci.yml");

describe("Gitea Actions CI Workflow", () => {
  test("ci.yml exists and has proper triggers", () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);

    const content = readFileSync(WORKFLOW_PATH, "utf-8");

    // Triggers
    expect(content).toContain("pull_request:");
    expect(content).toContain("push:");
    expect(content).toContain("workflow_dispatch:");
    expect(content).toContain("branches: [main]");
    expect(content).toContain("tags: ['v*']");
  });

  test("ci.yml defines test job with Bun 1.4.4 and strict checks", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");

    expect(content).toContain("test:");
    expect(content).toContain("runs-on: ubuntu-latest");
    expect(content).toContain("oven-sh/setup-bun@v2");
    expect(content).toContain("bun-version: 1.4.4");
    expect(content).toContain("bun install --frozen-lockfile");
    expect(content).toContain("bun run typecheck");
    expect(content).toContain("bun test");
  });

  test("ci.yml defines docker-build-and-push job with buildx and Gitea registry publishing", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");

    expect(content).toContain("docker-build-and-push:");
    expect(content).toContain("needs: test");
    expect(content).toContain("docker/setup-buildx-action@v3");
    expect(content).toContain("docker/metadata-action@v5");
    expect(content).toContain("images: ${{ env.REGISTRY }}/lucasw89/openproject-mcp");
    expect(content).toContain("docker/login-action@v3");
    expect(content).toContain("registry: ${{ env.REGISTRY }}");
    expect(content).toContain("username: lucasw89");
    expect(content).toContain("password: ${{ secrets.REGISTRY_TOKEN }}");
    expect(content).toContain("docker/build-push-action@v6");
    expect(content).toContain("push: ${{ gitea.event_name != 'pull_request' }}");
  });
});
