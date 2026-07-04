# Network TopoDraft

A graphical network-topology editor for `*.topo.json` files, built as a VSCode
custom editor. Opening a `.topo.json` file launches a canvas where you draw
devices, cables, carrier circuits, and logical (L3/VRF) adjacencies — while the
**text document stays the single source of truth**, so AI agents (GitHub
Copilot, Claude Code, NetBox-MCP-driven agents, …) can edit the same file as
text and the canvas follows.

This repository is a rebuild of the standalone HTML editor (frozen at v7,
preserved verbatim under [`reference/`](reference/)) into a monorepo of pure
TypeScript packages.

- File format specification: [`docs/topodraft-file-format-v1.md`](docs/topodraft-file-format-v1.md)
  — the normative contract for agents that read/write `*.topo.json`
- Published JSON Schema: [`schema/topodraft.schema.json`](schema/topodraft.schema.json)
- Development plan and ADRs: [`docs/topodraft-vscode-plan.md`](docs/topodraft-vscode-plan.md)

## Repository layout

```
packages/
  core/        DOM- and Node-free pure TypeScript: model, parse (legacy
               absorption), canonical serialize, validate (diagnostics),
               operations, geometry, generators (markdown / for-ai / schema /
               draw.io)
  webview-ui/  Canvas UI (Phase 1+; empty shell for now)
  extension/   VSCode extension host (Phase 1+; empty shell for now)
  protocol/    Webview ⇔ host message types (shared)
schema/        Published JSON Schema for format v1
fixtures/      Golden files: legacy v3–v7 export shapes + v1 canonical forms
docs/          Plan and file-format specification
reference/     The frozen v7 standalone HTML editor (never modified)
```

## Developing

Requires Node.js ≥ 20.

```sh
npm install
npm test               # runs every test in every package (vitest)
npm run test:coverage  # same, with core coverage thresholds enforced (plan §6.3)
npm run test:e2e       # VSCode integration tests (@vscode/test-electron)
npm run lint           # eslint (includes the core browser-purity rules)
npm run typecheck
npm run build          # bundles the extension host + webview (esbuild)
```

### Trying the editor (Phase 2: full canvas editing)

Open this repo in VSCode and press **F5** ("Run TopoDraft Extension"). The
Extension Development Host opens on `fixtures/`; open any `*.topo.json` there.

- **Draw**: drag node types from the palette, connect via the ◦ ports shown on
  hover (same-site → cable, cross-site or provider network → circuit; in the
  logical view, drag between VRF compartments for logical links).
- **Edit**: property panels for devices / provider networks / links, VRF chips,
  interface cards, a JSON Config Context modal, right-click context menus,
  double-click rename (references follow automatically), copy/paste/duplicate,
  align/distribute, arrow-key nudge.
- **Undo/redo is plain VSCode** (`Ctrl/Cmd+Z`): every canvas commit is one
  `WorkspaceEdit` on the text document — there is no editor-internal history.
- **Agent-friendly**: edit the JSON as text in a split (`Network TopoDraft:
  Open as Text`) and the canvas follows. Canvas edits computed against a stale
  document version are discarded, never overwriting agent edits. While the
  JSON is mid-edit/invalid, the canvas dims, editing pauses, and everything
  resumes automatically (ADR D11).

## Testing policy

Every PR that adds or changes behavior must add tests for it **and** keep the
entire existing suite green (plan §6.1). Modifying or deleting an existing test
is a spec change and must be called out explicitly in the PR description.

**Branch protection should mark the `CI` workflow as a required status check**
so this policy is enforced by mechanism, not convention.

Test layers (plan §6.2):

1. Core unit tests (model operations, rename reference-following, VRF
   derivation, geometry, generators)
2. Golden-file compatibility: every fixture in `fixtures/` must
   `parse → normalize → serialize` to its committed expected output, and the
   result must validate against `schema/topodraft.schema.json`
3. Serializer determinism: round-trip equivalence, byte-level idempotence,
   canonical key order / newline / indentation rules
4. Validate/diagnostics: detection and non-detection per rule

## Privacy

The extension collects no telemetry and loads no remote code.

## License

See [LICENSE](LICENSE). The license is not finalized yet; all rights reserved
until it is.
