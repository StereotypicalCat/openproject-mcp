import { describe, expect, test } from "bun:test";
import { SERVER_NAME, SERVER_VERSION } from "../src/index.ts";

describe("Server Initialization", () => {
  test("exports valid metadata", () => {
    expect(SERVER_NAME).toBe("openproject-mcp");
    expect(SERVER_VERSION).toBe("0.1.0");
  });
});
