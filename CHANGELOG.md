# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

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
