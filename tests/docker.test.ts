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
    if (process.env.SKIP_DOCKER_TESTS === "true" || process.env.CI === "true") {
      console.log("Skipping live docker build test in CI / SKIP_DOCKER_TESTS environment");
      return;
    }

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

    // Read stderr with a timeout loop up to 5000ms waiting for the startup banner
    let stderrText = "";
    const decoder = new TextDecoder();
    const reader = runProc.stderr.getReader();

    const readLoop = (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          stderrText += decoder.decode(value, { stream: true });
          if (stderrText.includes("[openproject-mcp] Server started (readOnly=true)")) {
            break;
          }
        }
      } catch {
        // stream closed or cancelled
      }
    })();

    const startTime = Date.now();
    while (
      Date.now() - startTime < 5000 &&
      !stderrText.includes("[openproject-mcp] Server started (readOnly=true)")
    ) {
      await Bun.sleep(50);
    }

    runProc.kill();
    await runProc.exited;
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    await readLoop;

    expect(stderrText).toContain("[openproject-mcp] Server started (readOnly=true)");
  }, 60000);
});
