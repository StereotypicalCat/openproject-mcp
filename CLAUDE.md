# Claude Instructions for openproject-mcp

Please refer to [AGENTS.md](./AGENTS.md) for primary project guidelines, coding conventions, architectural standards, and workflow instructions.

---

## Runtime & Tooling (Bun)

Default to using Bun instead of Node.js:

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` / `bun add` instead of `npm install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads `.env` and `.env.local`, so don't use `dotenv`.
- Prefer `Bun.file` over `node:fs` for reading and writing files.

## Testing

Use `bun test` to run tests:

```ts
import { test, expect, describe } from "bun:test";

describe("OpenProject Client", () => {
  test("authenticates via Basic Auth", () => {
    expect(1).toBe(1);
  });
});
```

For full details on project architecture and decisions, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DECISIONS.md](docs/DECISIONS.md).
