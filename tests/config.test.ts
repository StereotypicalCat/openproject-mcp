import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig, parseConfig } from "../src/config/index.ts";

describe("Configuration Loader (HTTP & Stdio Support)", () => {
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.argv = [...originalArgv.slice(0, 2)];
  });

  afterEach(() => {
    process.env = originalEnv;
    process.argv = originalArgv;
  });

  test("loads stdio configuration when PORT is unset and OPENPROJECT_API_KEY is provided", () => {
    process.env.OPENPROJECT_BASE_URL = "https://openproject.example.com";
    process.env.OPENPROJECT_API_KEY = "test-key";
    delete process.env.PORT;

    const config = loadConfig();
    expect(config.baseUrl).toBe("https://openproject.example.com");
    expect(config.apiKey).toBe("test-key");
    expect(config.readOnly).toBe(false);
    expect(config.port).toBeUndefined();
  });

  test("throws error if OPENPROJECT_API_KEY is missing in stdio mode", () => {
    process.env.OPENPROJECT_BASE_URL = "https://openproject.example.com";
    delete process.env.OPENPROJECT_API_KEY;
    delete process.env.PORT;

    expect(() => loadConfig()).toThrow();
  });

  test("throws error if OPENPROJECT_API_KEY is whitespace in stdio mode", () => {
    process.env.OPENPROJECT_BASE_URL = "https://openproject.example.com";
    process.env.OPENPROJECT_API_KEY = "   ";
    delete process.env.PORT;

    expect(() => loadConfig()).toThrow();
  });

  test("throws error if OPENPROJECT_BASE_URL is invalid", () => {
    process.env.OPENPROJECT_BASE_URL = "not-a-valid-url";
    process.env.OPENPROJECT_API_KEY = "test-key";
    delete process.env.PORT;

    expect(() => loadConfig()).toThrow();
  });

  test("normalizes baseUrl by stripping trailing slashes", () => {
    process.env.OPENPROJECT_BASE_URL = "https://openproject.example.com///";
    process.env.OPENPROJECT_API_KEY = "test-key";
    delete process.env.PORT;

    const config = loadConfig();
    expect(config.baseUrl).toBe("https://openproject.example.com");
  });

  test("loads HTTP configuration when PORT environment variable is set without API key", () => {
    process.env.OPENPROJECT_BASE_URL = "https://openproject.example.com";
    delete process.env.OPENPROJECT_API_KEY;
    process.env.PORT = "3000";

    const config = loadConfig();
    expect(config.baseUrl).toBe("https://openproject.example.com");
    expect(config.port).toBe(3000);
    expect(config.apiKey).toBeUndefined();
  });

  test("loads HTTP configuration with PORT=0 for dynamic assignment", () => {
    process.env.OPENPROJECT_BASE_URL = "https://openproject.example.com";
    delete process.env.OPENPROJECT_API_KEY;
    process.env.PORT = "0";

    const config = loadConfig();
    expect(config.baseUrl).toBe("https://openproject.example.com");
    expect(config.port).toBe(0);
    expect(config.apiKey).toBeUndefined();
  });

  test("loads HTTP configuration when HOST_PORT is set as fallback without PORT", () => {
    process.env.OPENPROJECT_BASE_URL = "https://openproject.example.com";
    delete process.env.OPENPROJECT_API_KEY;
    delete process.env.PORT;
    process.env.HOST_PORT = "3000";

    const config = loadConfig();
    expect(config.baseUrl).toBe("https://openproject.example.com");
    expect(config.port).toBe(3000);
    expect(config.apiKey).toBeUndefined();
  });

  test("loads HTTP configuration with API key when provided", () => {
    process.env.OPENPROJECT_BASE_URL = "https://openproject.example.com";
    process.env.OPENPROJECT_API_KEY = "test-key";
    process.env.PORT = "3000";

    const config = loadConfig();
    expect(config.baseUrl).toBe("https://openproject.example.com");
    expect(config.port).toBe(3000);
    expect(config.apiKey).toBe("test-key");
  });

  test("parses --port and --host CLI arguments", () => {
    process.env.OPENPROJECT_BASE_URL = "https://openproject.example.com";
    delete process.env.OPENPROJECT_API_KEY;
    delete process.env.PORT;
    process.argv.push("--port", "8080", "--host", "127.0.0.1", "--read-only");

    const config = loadConfig();
    expect(config.port).toBe(8080);
    expect(config.host).toBe("127.0.0.1");
    expect(config.readOnly).toBe(true);
  });

  test("parses --port=value and --host=value CLI arguments", () => {
    process.env.OPENPROJECT_BASE_URL = "https://openproject.example.com";
    delete process.env.OPENPROJECT_API_KEY;
    delete process.env.PORT;
    process.argv.push("--port=9090", "--host=0.0.0.0");

    const config = loadConfig();
    expect(config.port).toBe(9090);
    expect(config.host).toBe("0.0.0.0");
  });

  test("CLI arguments take precedence over environment variables", () => {
    process.env.OPENPROJECT_BASE_URL = "https://openproject.example.com";
    process.env.PORT = "3000";
    process.env.HOST = "127.0.0.1";
    process.argv.push("--port", "4000", "--host", "0.0.0.0");

    const config = loadConfig();
    expect(config.port).toBe(4000);
    expect(config.host).toBe("0.0.0.0");
  });

  test("throws error if port is non-numeric", () => {
    process.env.OPENPROJECT_BASE_URL = "https://openproject.example.com";
    process.env.PORT = "not-a-port";

    expect(() => loadConfig()).toThrow();
  });

  test("throws error if port is out of range", () => {
    process.env.OPENPROJECT_BASE_URL = "https://openproject.example.com";
    process.env.PORT = "70000";

    expect(() => loadConfig()).toThrow();
  });

  test("parseConfig alias works identically to loadConfig", () => {
    const config = parseConfig(
      {
        OPENPROJECT_BASE_URL: "https://openproject.example.com",
        OPENPROJECT_API_KEY: "alias-key",
      },
      []
    );
    expect(config.baseUrl).toBe("https://openproject.example.com");
    expect(config.apiKey).toBe("alias-key");
  });
});
