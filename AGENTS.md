# AGENTS.md

## Cursor Cloud specific instructions

This is an **Obsidian plugin** (not a standalone app). It cannot run independently — it runs inside the Obsidian desktop application. There is no backend server, database, or Docker dependency.

### Build & type-check commands

See `CLAUDE.md` and `package.json` scripts for standard commands:

- `npm run dev` — development build (with inline sourcemap, outputs `main.js`)
- `npm run build` — production build (minified)
- `npx tsc --noEmit` — TypeScript type-check (no ESLint config exists in this repo)

### Key caveats

- **No test suite**: There is no `npm test` script or test framework configured. Validate changes with `npx tsc --noEmit` and `npm run build`.
- **No ESLint**: No ESLint configuration exists. TypeScript compiler is the only static analysis tool.
- **Plugin output**: Both `npm run dev` and `npm run build` produce `main.js` in the project root. This file, along with `manifest.json` and `styles.css`, is what gets loaded by Obsidian.
- **External dependencies at runtime**: The `obsidian` module and CodeMirror/Lezer packages are externalized by esbuild — they are provided by the Obsidian host at runtime.
- **AI features require API keys**: Agent, translation, and knowledge extraction features need an OpenAI-compatible API key configured in plugin settings. E2B sandbox is optional.
