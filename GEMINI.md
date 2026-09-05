# Gemini Instructions for openproject-mcp

Please refer to [AGENTS.md](./AGENTS.md) for all project guidelines, coding conventions, architectural standards, and workflow instructions.

All agents operating in this repository must default to **Bun** instead of Node.js:
- Run commands with `bun run <script>`, `bun <file>`, and `bun test`.
- Manage dependencies with `bun add` and `bun install`.
- Rely on Bun's built-in TypeScript execution and `.env` loading.
