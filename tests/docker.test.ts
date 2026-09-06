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
