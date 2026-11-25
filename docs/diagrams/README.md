# Diagrams

Every diagram is an archify typed JSON source in this folder, rendered to an interactive page (`.html`) and an exported image (`.svg`). Edit the JSON, then regenerate the other two; never edit the SVG by hand.

| Diagram | Type | Embedded in |
|---|---|---|
| `architecture` | `architecture` | `README.md`, `docs/architecture.md` |
| `lead-sequence` | `sequence` | `README.md`, `docs/architecture.md` |

## Regenerating a diagram

[archify](https://github.com/tt-a1i/archify) is Node.js with no install step, last checked at v3.2.0. Clone it outside this repo, so `pnpm run lint` never scans it: `git clone --depth 1 --branch v3.2.0 https://github.com/tt-a1i/archify ../archify`. Run every command from the repo root, since each source's `meta.output` is relative to it. Replace `<type>` and `<name>` with the diagram's type and file name from the table.

1. Validate after every edit, until all 9 artifact checks pass with 0 composition errors and 0 warnings: `node ../archify/archify/bin/archify.mjs validate <type> docs/diagrams/<name>.json --quality showcase --json`.
2. Deliver the page: `node ../archify/archify/bin/archify.mjs deliver <type> docs/diagrams/<name>.json docs/diagrams/<name>.html --quality showcase --json`. It also writes a gitignored `docs/diagrams/<name>.delivery.json` receipt with local absolute paths; never force-add one.
3. Open the page, choose **Export**, then **SVG · Auto**, and save over `docs/diagrams/<name>.svg`.
4. Optionally, check the page at four desktop sizes: `node ../archify/archify/bin/archify.mjs visual-check docs/diagrams/<name>.html --json --out-dir ../archify-evidence`.

Every diagram is cited by `README.md`, `AGENTS.md` and `docs/architecture.md`; `tests/docs.test.ts` fails on one that isn't.
