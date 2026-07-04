# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

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
- Commands: `Network TopoDraft: Open as Text` / `Open in Topology Editor`.
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
