#!/usr/bin/env bun
/**
 * openproject-mcp - Model Context Protocol Server for OpenProject
 */

import { parseConfig } from "./config";
import { createServer } from "./server";
import { startHttpServer } from "./http-server";

async function main(): Promise<void> {
  try {
    const config = parseConfig(process.env, process.argv);

    let isShuttingDown = false;

    if (config.port !== undefined) {
      console.error(
        `[openproject-mcp] Starting hosted HTTP server on ${config.host || "0.0.0.0"}:${config.port}...`
      );
      const httpServer = await startHttpServer(config);

      const shutdown = async () => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        console.error(
          "\n[openproject-mcp] Received termination signal, shutting down HTTP server..."
        );
        await httpServer.stop();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    } else {
      const mcpServer = createServer(config);

      const shutdown = async () => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        console.error(
          "\n[openproject-mcp] Received termination signal, shutting down..."
        );
        await mcpServer.stop();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // Start server over stdio transport
      await mcpServer.start();
    }
  } catch (error) {
    console.error(
      "[openproject-mcp] Fatal startup error:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

// Only execute when invoked directly as a script
if (import.meta.main) {
  main();
}

export { createServer } from "./server";
export { SERVER_NAME, SERVER_VERSION } from "./server";
export { startHttpServer, type HttpServerInstance } from "./http-server";

