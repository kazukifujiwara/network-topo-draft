# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- (internal) `packages/app-view` (#28): the webview-ui canvas bundled as
  ONE self-contained HTML document — the future `ui://` resource of the
  MCP Apps support (#26). Renders from a plain DOM root through the same
  `AppHost` seam the VSCode webview uses; the build fails on any remote
  reference.
- (internal) MCP Apps bridge (#29): the widget now speaks the MCP Apps
  dialect via the ext-apps `App` client — `ui/notifications/tool-result`
  `structuredContent` (canonical topology + view options) becomes the
  same `update` message the VSCode webview receives; canvas edits are
  dropped behind a marked phase-2 seam (#25), authoring chrome is hidden,
  and bridge errors surface in the canvas's own error bar.
- MCP Apps server wiring (#30): `render_svg` now declares the interactive
  canvas (`_meta.ui.resourceUri` → `ui://topodraft/canvas.html`,
  registered as a `text/html;profile=mcp-app` resource) and delivers the
  canonical topology + view options via `structuredContent`; the SVG text
  stays in `content` as the model-visible fallback. Without the widget
  (or on non-Apps hosts) behavior is unchanged from v0.5.0. A dev-only
  Streamable-HTTP harness (`packages/mcp/dev/serve-http.mjs`) serves the
  same server to the ext-apps basic-host for verification.

## [0.5.0] — 2026-07-10

### Added

- MCP server (#11): new `topodraft-mcp` package — a stdio Model Context
  Protocol server so AI agents can learn the file format
  (`describe_format`), read topologies (`read_topology`: summary +
  canonical JSON), and validate edits (`validate_topology`: the editor's
  full diagnostics incl. did-you-mean) through any MCP client. Read-only
  v1; local file access only, no network, no telemetry, zero runtime
  dependencies (self-contained bundle). Published separately to npm with
  its own versioning.
- MCP `render_svg` tool (#13): agents can see the diagram they are
  editing — renders either view to the same standalone SVG as the
  editor's image export (options for the global row, the physical
  underlay, and a transparent background).
- MCP edit tools (#12): `add_device` / `update_device` / `remove_device` /
  `add_link` / `remove_link` / `set_position` — structured mutations with
  validation-in-the-loop: every edit goes parse → mutate → deterministic
  serialize, endpoints and names are checked against the document, and
  the response carries the post-edit diagnostics. `--read-only` starts
  the server without the edit tools.
- Docs (#14): the generated AI agent guide (AGENTS.md) now routes
  MCP-connected agents — bulk authoring writes the file directly, small
  changes use the edit tools, every change is validated, `render_svg` is
  the layout check — and the READMEs (repo en/ja, Marketplace) describe
  the MCP server and its setup.

## [0.4.0] — 2026-07-09

### Added

- Image export (#10): `TopoDraft: Export as Image (SVG / PNG)` commands and
  matching entries in the canvas **Export** menu. Exports render the
  CURRENT view (physical or logical, underlay and global-row toggles
  respected) in the editor's look; SVG is a standalone vector file, PNG is
  rasterized at `topodraft.pngExportScale` (default 2×, applies live to
  open editors; the confirmation shows the pixel size). Logical-view
  exports get a `.logical` filename suffix so both views of one topology
  coexist. Works on the web build (vscode.dev) — files are written via
  the workspace file system.
- (internal) Pure SVG renderer in `@topodraft/core` (`genSvg`): renders a
  topology to a standalone SVG string with the same geometry and
  view-model code as the canvas, in either view (physical/logical), with
  optional transparent background — the engine behind the image export
  (#9).

### Fixed

- `Open Example Topology` (and the walkthrough's first step) failed on the
  web (vscode.dev / vscode-test-web) when no workspace folder was open:
  the untitled URI used a relative path that cannot resolve against the
  web default file system. The untitled path is now absolute (#16).

## [0.3.0] — 2026-07-08

### Added

- "Get Started with TopoDraft" walkthrough on VS Code's Welcome page —
  shown right after install (before any .topo file exists): open the
  bundled example, draw a first change, create your own file from a
  template, set up the AI-agent flow (AGENTS.md), and validate. Steps
  auto-complete as the commands run; localized (en/ja) with illustrated
  media (VSIX grows ~120 KB of optimized images).

- First-run onboarding: a truly empty `*.topo.json` / `*.topo` file now
  opens as a scaffold — the friendly empty-canvas hint (which now also
  points at the ＋ New template menu) with editing enabled, instead of the
  "Invalid JSON" error view; the first canvas edit writes valid JSON.
  Malformed non-empty documents keep the exact error behavior.
- `TopoDraft: Open Example Topology`: opens a bundled example as an
  untitled document — no save dialog, nothing written to disk unless you
  save. Works on vscode.dev / github.dev.
- A "Getting started" section at the top of the Marketplace page.

### Fixed

- `topodraft.templatesFolder` now accepts a full URI (e.g. `vscode-vfs://…`),
  so user templates resolve on virtual workspaces (vscode.dev / github.dev).
  Absolute file-system paths and workspace-relative values are unchanged.

## [0.2.0] — 2026-07-07

### Added

- Web extension support: TopoDraft now runs on vscode.dev / github.dev.
  A second, additive browser bundle (`dist/extension-web.js`) targets the
  Web Worker extension host; the desktop build and behavior are unchanged.
  The manifest declares `virtualWorkspaces: true` — every feature already
  works through `vscode.workspace.fs` and TextDocuments, so virtual
  (non-file) workspaces are fully supported. A @vscode/test-web smoke test
  (activation, custom editor, diagnostics on a virtual workspace) runs in
  CI alongside the existing desktop suites.

### Changed

- The agent guide's headless-validation step now points at the published
  CLI (`npx topodraft-cli validate`) instead of generic self-validation
  advice — deferred until the package actually existed on npm.

## [0.1.0] — 2026-07-05

First public release: the VSCode extension (Marketplace) and the
`topodraft-cli` npm package.

### Changed

- Supply-chain hardening: `npm audit` shows 0 advisories across ALL
  dependencies — the only runtime dependency is jsonc-parser (bundled;
  core/protocol/webview have zero external dependencies), and the two
  dev-toolchain advisories (mocha → serialize-javascript ≤7.0.4,
  GHSA-5c6j-r48x-rmvq / GHSA-qj8w-gfj5-8c6v) were fixed via an override
  to 7.0.7. CI now gates every push on `npm audit --omit=dev` (any
  severity) plus a high-severity gate for the dev toolchain, and both
  READMEs document the complete third-party list with commands for users
  to verify the VSIX contents themselves.
- Documentation audit (fairness / ethics / presumptions): remaining
  product names outside the allowed integration targets (NetBox, draw.io,
  agent harnesses) were genericized in the format spec's examples and the
  provider-network panel help text (DX / FastConnect → dedicated cloud
  interconnect); a vendor-neutrality guard test now also covers the
  webview UI dictionaries. The agent guide's validation step no longer
  assumes the agent can see VSCode diagnostics (headless agents are told
  to validate against the schema themselves), and both READMEs scope
  "source of truth" to the canvas, not the network.
- The agent guide no longer calls the file "the single source of truth":
  the file is authoritative for the DIAGRAM only — the source of truth for
  the network itself is the organization's configuration/inventory system
  (e.g. NetBox), and the file is a view of it. A guard test keeps the
  claim out.
- Shipped agent-facing text (guide, schema descriptions, schema-doc
  example, for-AI export boilerplate) mentions no product names except
  NetBox, the integration target — AWS Direct Connect / Cisco / Equinix
  examples replaced with generic equivalents; guard test added. The
  guide's tool-routing rule was also rephrased positively ("prefer this
  format; other formats only when explicitly asked") instead of naming
  third-party diagram tools in a "do not use" sentence.
- The opt-in NetBox guide section is now strictly READ-focused ("NetBox
  Reference Notes"): it explains how NetBox objects map onto the format and
  how to pull data into a file, and explicitly declares automated WRITES to
  NetBox out of scope (add your own instructions outside the TopoDraft
  markers, at your own risk; prefer read-only API tokens). The extension
  ships no push-workflow instructions.

### Added

- Publication polish: Marketplace Q&A disabled in favor of GitHub Issues
  as the single support channel, gallery banner in the brand color,
  CI/license badges, SECURITY.md with private vulnerability reporting,
  and Windows CI jobs (build + unit tests + VSCode E2E on windows-latest)
  with a .gitattributes that pins LF line endings — the deterministic
  serializer's byte-identity guarantees now hold on Windows checkouts too.

- Extension icon: the letter N drawn as a network topology — four nodes,
  solid verticals for physical links and a dotted diagonal for the logical
  link, in the editor's canvas colors. SVG master in `assets/logo.svg`,
  256px PNG shipped in the VSIX.

- License decided: **Apache License 2.0** (was an all-rights-reserved
  placeholder). LICENSE carries the canonical text, a NOTICE file names
  the project and copyright holder, every package declares the SPDX id,
  and both the VSIX and the npm package ship LICENSE + NOTICE.

- `topodraft validate` CLI (new package `topodraft-cli`, command
  `topodraft`): the editor's full validation loop for headless use — AI
  agents running outside VSCode and CI pipelines get the same diagnostics
  as the Problems panel (JSON syntax, topology shape, semantic rules,
  unknown fields with did-you-mean), each with file:line:col. `--json`
  for machine-readable output, `--strict` to fail on warnings; a single
  self-contained bundle with the same supply-chain surface as the
  extension. Born from a real observed gap: a headless agent hand-rolled
  its own partial validator because it could not read the Problems panel.
- The CLI immediately caught a real defect in our own canonical example:
  the format-spec §6 example (and its fixture) had a circuit referencing
  interface `Gi0/0/0` that was never declared — the parent interface is
  now declared, so the documented example validates clean.

- NetBox sync notes became an OPT-IN guide section (not every user runs
  NetBox): the default AGENTS.md guide is NetBox-free again, and a separate
  marker-delimited section is written only via the ✨ AI Guide dialog's new
  checkbox or `TopoDraft: Write NetBox Sync Notes (AGENTS.md)`. The section
  now also covers pitfalls field-tested against a real NetBox 4.x push —
  cables cannot terminate on LAG interfaces (expand to member cables),
  cables need concrete interfaces on both ends (ask, don't invent stubs),
  circuit terminations attach via `termination_type`, and dry-run +
  tag-everything workflow rules. The default guide gained NetBox-agnostic
  layout conventions (node size, tiering, one-edit re-arrangement) and a
  "re-read after the editor normalizes on save" rule, both learned from a
  real agent session.

- Dedicated `*.topo` file-name alias alongside the canonical `*.topo.json`:
  both open in the topology editor with schema validation and JSON language
  support. `.topo.json` stays the default for new files (universally
  recognized as JSON); `.topo` survives Finder copies ("test.topo copy.json"
  no longer escapes the editor) and save-dialog stem edits.

- NetBox naming alignment: `fhrp.group` renamed to `group_id` (NetBox
  FHRPGroup naming; the old key is absorbed on load, `version` stays 1),
  and the AGENTS.md agent guide gained NetBox mapping notes — FK/slug/unit
  conversion caveats, flattenings, extension fields never to push,
  name-based identity, and merge-not-regenerate guidance for pulls.

- ＋ New button in the canvas toolbar: runs the New Topology File command,
  showing the same template QuickPick (built-ins + your templates folder)
  as the command palette.

- AI Guide dialog: a prominent callout states that an existing AGENTS.md is
  never overwritten (only the marker section is appended/updated), plus a
  "Save as…" option to write the guide to a different file; the example
  prompt now says VRF-001. The guide itself gained creation rules for
  agents: use this format when asked for network diagrams (not image /
  generic diagram tools) and name files `*.topo.json`, with a starter
  skeleton including `$schema`.

- New built-in template "Routed LAG pair": two routers uplinked to a switch
  pair over 2-member LAGs — a ready-made example of the `lag` /
  `type: "lag"` interface notation (vendor-neutral).
- The right properties panel can be collapsed with a slim strip button on
  its edge to maximize the canvas; the state persists per editor, and any
  new selection re-opens the panel so properties are never edited blind.

### Fixed

- In the logical view, links between a device pair carrying several VRFs
  were bundled by node pair (v7 behavior) and spread 16px apart — pushing
  endpoints off their 20px VRF compartment rows. Parallel-offset bundles
  are now keyed by (node, VRF) anchor pair and never mix with the physical
  underlay, so endpoints sit exactly on their rows; true duplicates of the
  same VRF pair still spread apart.
- Stale-host detection: reinstalling a same-version VSIX replaces the files
  on disk while the running extension host keeps the old code in memory —
  newly opened editors then load the NEW webview against the OLD host and
  misbehave in confusing ways (e.g. an empty ＋New menu). Both bundles now
  share a build id; on mismatch the canvas shows a persistent "run
  Developer: Reload Window" hint. The host also logs each unhandled webview
  message and the template-list replies to the TopoDraft output channel.
- The toolbar ＋ New button appeared to do nothing: the webview re-takes
  focus right after the click, dismissing the template QuickPick before it
  became visible (microsoft/vscode#214787) — `ignoreFocusOut` was not
  enough in practice. The button is now a dropdown menu like Export: the
  host supplies the localized template list (built-ins + your templates
  folder), picking an entry goes straight to the save dialog, and no
  QuickPick is involved. The command-palette path keeps the QuickPick,
  and the command logs its progress to the TopoDraft output channel.
- Link endpoints around network-segment nodes in the logical view were
  misaligned: segments are drawn as pills (24px corner radius) but link
  anchors were computed against the square bounding box, so diagonal
  attachments landed up to ~20px outside the visible shape. Anchors (and
  the link-drag preview) now intersect the actual rounded boundary.
- Logical links attached to a `networks[]` segment were not drawn on the
  canvas (the endpoint-name resolution ignored `network`) — regression
  test added.
- Diagnostics and commands now also apply to a bare `topo.json`, matching
  what the custom-editor glob `*.topo.json` actually claims.

- Multi-access L3 segments (format spec §3.10, backward-compatible —
  `version` stays 1): new top-level `networks[]` (name, prefix, vlan,
  `fhrp { protocol, group, virtual_ip }`, description, position) and a
  third logical-endpoint shape `{ "network": "<name>" }`. Segments render
  as pill nodes in the logical view only — the physical view is untouched.
  Palette item, property panel, rename-with-references, clipboard support,
  draw.io/Markdown/for-AI export, schema + agent guide updated, and new
  `ip-outside-prefix` diagnostics (attached interface/endpoint IPs and the
  FHRP virtual IP are checked against the prefix). New built-in template:
  "Gateway pair + segment (HSRP)".

- ✨ AI Guide button in the canvas toolbar (next to Export): explains what
  the agent guide is for and writes AGENTS.md on confirmation — the same
  contract as the command-palette command, now discoverable from the editor.

- Agent interop, driven by a real transcript of an AI agent failing to
  discover the format:
  - unknown-field diagnostics on the raw text with did-you-mean suggestions
    (`"ip"` → did you mean `"ip_address"`?) and a note that unknown fields
    are dropped on save — the reactive self-correction path (spec §7)
  - `TopoDraft: Write AI Agent Guide (AGENTS.md)` writes the complete,
    offline-usable format contract (workflow rules + JSON Schema + example)
    into the workspace file agent harnesses read automatically — the
    proactive path; regeneration is idempotent via marker comments
  - built-in templates and New File output now embed the live `$schema` URL
    (O3 resolved: raw.githubusercontent.com main-branch URL, verified
    reachable), so any tool can fetch the contract from the file itself

- VSIX packaging (`npm run package`, vsce with `--no-dependencies` since
  everything is esbuild-bundled): 13-file / ~67 KB artifact with dist
  bundles, schema, en/ja localization, and a Marketplace-facing extension
  README. CI uploads the VSIX as a workflow artifact on every push
  (Phase 4 groundwork, plan §9).

- Export button in the canvas toolbar (like v7): a dropdown offering
  Markdown / For AI / Schema / draw.io, running the corresponding export
  command against this editor's document.

### Changed

- Built-in templates no longer reference real vendor or service names
  (AWS Direct Connect, Equinix, …) — replaced with generic equivalents
  (Cloud Interconnect, ExampleNet, cloud-gw-01, …); a regression test keeps
  shipped defaults vendor-neutral. Example placeholders in the property
  panel were genericized the same way.

- Phase 3 — periphery: semantic diagnostics in the Problems panel (core
  validate() with jsonc-parser path→range resolution; `TopoDraft:
  Validate` command); export commands (Markdown / for AI / import-schema /
  draw.io); `New Topology File` with built-in templates plus file-based user
  templates (`topodraft.templatesFolder`, O2 ruling) and `Save as Template`;
  editor-title buttons to switch between text and topology views; UI
  localization (en/ja) following the VSCode display language (ADR D13).

### Fixed

- Extension activation failed at runtime because esbuild could not statically
  bundle jsonc-parser's UMD build ("Cannot find module './impl/format'") —
  the host bundle now prefers ESM entry points (`mainFields`).

- Phase 2 — canvas editing with the text document as the single source of
  truth: every canvas commit (drag mouseup, panel field change, 400ms nudge
  debounce) serializes the model and is applied as one `WorkspaceEdit`, so
  undo/redo is VSCode's regular document history (ADR D6). Edits computed
  against a stale document version are discarded (agent-race guard) and
  self-originated updates are echo-suppressed (plan §4.2).
- Ported v7 editing UI: node palette with drag placement, port-drag link
  creation (cable/circuit/logical kind rules), selection (click / shift /
  marquee / Ctrl+A), drag with grid snap and alignment guides, property
  panels (device, provider network, multi-select, physical and logical links
  with endpoint IP write-through), VRF chips, interface cards, Config Context
  JSON modal, context menus (rename, role change, cable⇄circuit conversion,
  paste here, clear canvas), inline rename with reference-following
  (ADR D10), copy/paste/duplicate with unique renaming, align/distribute,
  keyboard shortcuts without Ctrl+K (ADR D14).
- Core operations: `makeClipboard` / `pasteClipboard` (reference remapping),
  `convertCableToCircuit` / `convertCircuitToCable`.
- E2E: undo/redo delegation and the stale-edit discard verified through the
  real WorkspaceEdit path via a test-only hook.

- Phase 1 — read-only viewer: opening a `*.topo.json` launches the Network
  TopoDraft custom editor (`topodraft.editor`, default for the pattern).
  Physical/logical views with VRF compartments, site frames, link labels,
  underlay/global/grid toggles, pan/zoom/fit; view state survives tab
  switches. The canvas follows external (agent) text edits; invalid JSON
  shows the last good canvas dimmed under an error bar and recovers
  automatically (ADR D11) — the viewer never writes to the document.
- `jsonValidation` contribution: schema validation and completion for
  `*.topo.json` while editing as text.
- Commands: `TopoDraft: Open as Text` / `Open in Topology Editor`.
- E2E test harness (`@vscode/test-electron`) covering editor association,
  D11 no-write-back, and the reopen commands; new CI job runs it headless.

- Phase 0 foundation: npm-workspaces monorepo (core / webview-ui / extension /
  protocol), CI, lint, and a single root `npm test`.
- `@topodraft/core`: pure browser-compatible TypeScript extraction of the v7
  data layer — `parse` (absorbs legacy v3–v7 export shapes), canonical
  deterministic `serialize` (format spec §4), `validate` (initial diagnostics
  rule set, plan §4.6), `operations` (rename with reference-following, endpoint
  IP write-through, align/distribute, auto-layout), `geometry`, and the four
  generators (Markdown, For-AI, import-schema doc, draw.io).
- `schema/topodraft.schema.json`: published JSON Schema (draft-07) for format
  v1 with `additionalProperties: false`.
- Golden fixtures for v3-, v4/v5-, and v6/v7-style legacy exports plus v1
  canonical files, with round-trip and schema-validation tests.

### Changed

- Format spec §6 example corrected to follow the normative key order of §4
  rule 3 (errata).
