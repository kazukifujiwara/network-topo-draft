# TopoDraft — Network Topology as Code

A graphical network-topology editor for `*.topo.json` files (alias: `*.topo`),
built as a VSCode custom editor. Opening one launches a canvas where you draw
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
  webview-ui/  Canvas UI: scene rendering, interactions, panels, toolbar
               (jsdom-tested; talks to the host only via protocol messages)
  extension/   VSCode extension host: custom editor, sync loop, diagnostics,
               commands, templates, agent guide
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
npm run package        # builds packages/extension/topodraft-<version>.vsix
```

To install the VSIX into your own VSCode: Extensions panel → `…` menu →
**Install from VSIX…** (or `code --install-extension topodraft-<version>.vsix`).
CI also uploads the VSIX as a workflow artifact on every push.

> **Reinstalling a same-version VSIX?** Run **Developer: Reload Window**
> afterwards — the running extension host keeps the old code in memory until
> the window reloads (the canvas shows a reload hint when it detects this).

### Trying the editor

Open this repo in VSCode and press **F5** ("Run TopoDraft Extension"). The
Extension Development Host opens on `fixtures/`; open any `*.topo.json` there.

- **Draw**: drag node types from the palette, connect via the ◦ ports shown on
  hover (same-site → cable, cross-site or provider network → circuit; in the
  logical view, drag between VRF compartments for logical links).
- **Multi-access L3 segments** (format spec §3.10): `networks[]` entries render
  as pill nodes in the logical view — subnets shared by several devices, with
  optional FHRP (HSRP/VRRP) group and virtual IP. Each attached device gets one
  logical link with a `{ "network": "<name>" }` endpoint.
- **Edit**: property panels for devices / provider networks / segments / links,
  VRF chips, interface cards, a JSON Config Context modal, right-click context
  menus, double-click rename (references follow automatically),
  copy/paste/duplicate, align/distribute, arrow-key nudge. The properties
  panel collapses via the strip button on its edge when you want the full
  canvas; selecting something re-opens it.
- **Undo/redo is plain VSCode** (`Ctrl/Cmd+Z`): every canvas commit is one
  `WorkspaceEdit` on the text document — there is no editor-internal history.
- **Agent-friendly**: edit the JSON as text in a split (`TopoDraft:
  Open as Text`, also the `</>` button in the editor title bar) and the canvas
  follows. Canvas edits computed against a stale document version are
  discarded, never overwriting agent edits. While the JSON is
  mid-edit/invalid, the canvas dims, editing pauses, and everything resumes
  automatically (ADR D11).
- **Problems panel**: semantic diagnostics (duplicate names, dangling
  references, missing LAG parents, unknown interfaces, undeclared VRFs,
  IPs outside a segment's prefix, missing version, and misspelled fields with
  did-you-mean suggestions — `"ip"` → `"ip_address"`) with ranges pointing at
  the offending text — the loop AI agents use to self-correct.
  `TopoDraft: Validate` runs it on demand.
- **Teach your agents the format up front**: `TopoDraft: Write AI Agent
  Guide (AGENTS.md)` — also the ✨ AI Guide toolbar button — drops the full
  file-format contract (rules + JSON Schema + example) into the workspace
  where coding agents (Claude Code, Copilot, …) discover it automatically
  (idempotent marker-based section; "Save as…" writes elsewhere). New files
  also carry a `$schema` URL pointing at the published schema.
- **Commands**: `New Topology File` (built-in templates + your own — any
  `*.topo.json` under `topodraft.templatesFolder`, default
  `.topodraft/templates`), `Save as Template`, and `Export as Markdown /
  for AI / Import-Schema / draw.io`. The canvas toolbar mirrors the common
  ones: **＋ New** (template menu) and **Export** dropdowns.
- **Languages**: UI follows the VSCode display language (English/Japanese).

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
