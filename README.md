# TopoDraft — Network Topology as Code

**English** | [日本語](README.ja.md)

[![CI](https://github.com/kazukifujiwara/network-topo-draft/actions/workflows/ci.yml/badge.svg)](https://github.com/kazukifujiwara/network-topo-draft/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![VS Marketplace](https://img.shields.io/github/v/release/kazukifujiwara/network-topo-draft?label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=kazukifujiwara.topodraft)
[![npm](https://img.shields.io/npm/v/topodraft-cli?label=topodraft-cli)](https://www.npmjs.com/package/topodraft-cli)

<img src="assets/logo.svg" width="112" align="right" alt="TopoDraft logo: the letter N drawn as a network topology — two solid physical links and a dotted logical link connecting four nodes">

A graphical network-topology editor for `*.topo.json` files (alias: `*.topo`),
built as a VSCode custom editor. Opening one launches a canvas where you draw
devices, cables, carrier circuits, and logical (L3/VRF) adjacencies — while
the **text document stays authoritative for the canvas** (the drawing is just
a view of it), so AI agents (GitHub Copilot, Claude Code, NetBox-MCP-driven
agents, …) can edit the same file as text and the canvas follows.

![Demo: an AI agent builds a two-site network step by step and the TopoDraft canvas draws each device, cable, and inter-site circuit live](assets/demo.gif)

*An AI agent builds a two-site network by editing the JSON — the canvas follows every step live.*

![Logical view: VRF-1 compartments on four routers connected by eBGP adjacencies over the carrier circuits, with a VRRP segment (virtual IP shown) at each site and the property panel open](assets/screenshot-logical.png)

*The logical view: VRF compartments, L3 adjacencies, and multi-access VRRP segments — edited in the same file.*

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
  cli/         `topodraft` command (package: topodraft-cli): the editor's
               validation as a CLI, for headless use and AI agents
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

Install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=kazukifujiwara.topodraft)
(search "TopoDraft" in the Extensions panel). For development builds:
Extensions panel → `…` menu → **Install from VSIX…** — CI uploads the VSIX
as a workflow artifact on every push.

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
- **Commands**: `Open Example Topology` (instant canvas from a bundled
  example — an untitled document, no file setup), `New Topology File`
  (built-in templates + your own — any
  `*.topo.json` under `topodraft.templatesFolder`, default
  `.topodraft/templates`), `Save as Template`, and `Export as Markdown /
  for AI / Import-Schema / draw.io`. The canvas toolbar mirrors the common
  ones: **＋ New** (template menu) and **Export** dropdowns.
- **Languages**: UI follows the VSCode display language (English/Japanese).

## CLI validation (`topodraft validate`)

Headless environments — CI pipelines and AI agents running outside VSCode —
get the exact same diagnostics as the editor's Problems panel:

```sh
npx topodraft-cli validate network/*.topo.json   # also: npx topodraft validate
```

```
network/dc-east.topo.json:14:22 error dangling-reference Endpoint references device "ghost", …
network/dc-east.topo.json:9:31 warning unknown-field Unknown field "ip" — did you mean "ip_address"? …
```

- JSON syntax → topology shape → semantic rules → unknown fields with
  did-you-mean, each with `file:line:col`
- `--json` for machine-readable output, `--strict` to fail on warnings,
  exit codes 0 / 1 / 2 (clean / findings / usage-or-IO error)
- Zero runtime dependencies beyond the ones already shipped in the
  extension (core + jsonc-parser, bundled)

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

## Third-party software (supply chain)

Everything that ships in the VSIX is bundled at build time — the package
contains no `node_modules` and installs nothing at runtime.

| Scope | Library | License | Why |
| --- | --- | --- | --- |
| Bundled into the extension host | [jsonc-parser](https://github.com/microsoft/node-jsonc-parser) | MIT | resolving JSON paths to text ranges for Problems-panel diagnostics |

That is the complete runtime list: `packages/core`, `packages/protocol`,
and the webview bundle have **zero external dependencies** (enforced by a
purity test and ESLint rules). Everything else in `package-lock.json` is
development toolchain only (TypeScript, esbuild, vitest, ESLint,
@vscode/test-electron + mocha, @vscode/vsce) and never ships.

Verify it yourself:

```sh
npm ls --omit=dev --all     # the full runtime dependency tree
npm audit --omit=dev        # advisories against shipped dependencies
npx vsce ls                 # exactly what goes into the VSIX
```

CI runs `npm audit --omit=dev` (any severity) and a high-severity gate for
the dev toolchain on every push.

## Privacy

The extension collects no telemetry and loads no remote code.

## License

[Apache License 2.0](LICENSE) — Copyright 2026 Kazuki Fujiwara. Permissive
use, modification, and redistribution with an explicit patent grant; the
TopoDraft name is not licensed (Apache-2.0 §6).
