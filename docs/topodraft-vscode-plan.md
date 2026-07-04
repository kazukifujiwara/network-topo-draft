# TopoDraft VSCode Extension — Development Plan

- Status: v1.1 (2026-07) — Phases 0–4 (groundwork) implemented; post-plan
  decisions and intentional v7 deviations are logged in Appendix B
- Audience: implementer (Claude Code) and reviewer (Kazuki)
- Related documents: `topodraft-file-format-v1.md` (file format spec / the contract with AI agents), `topodraft-spec.md` (standalone HTML v7 specification)

---

## 1. Purpose and Goals

Provide the same topology-editing experience as the standalone HTML version of TopoDraft (v7) as a VSCode custom editor.

**Goals**
1. Opening a `*.topo.json` file in VSCode launches the TopoDraft graphical editor
2. AI agents (GitHub Copilot / Claude Code, etc.) can **edit the same file directly as text** and the canvas follows (and vice versa)
3. NetBox integration is delegated to AI agents (NetBox MCP / API); the extension itself does not implement it. As the foundation for that, the file format and JSON Schema are rigorously defined and published with NetBox-compatible naming
4. A test regime that detects regressions on every feature addition is in place from day one

**The single most important design inversion**: the standalone HTML version treated "in-memory state as the source of truth, Export produces a file." The extension inverts this: "**the open text document is the source of truth; the Webview is a view of it.**" Every design decision below follows from this premise.

## 2. Decisions (ADR)

| # | Decision | Rationale / notes |
| --- | --- | --- |
| D1 | Adopt the `CustomTextEditor` API; the text document is the source of truth | Bidirectional sync between agent edits and canvas edits is built on VSCode's standard TextDocument machinery. We do NOT use `CustomEditor` (custom document model) |
| D2 | Target files are `*.topo.json` only. **YAML is removed entirely** in the extension (file format, import/export, and the Config Context YAML tab) | Making JSON canonical avoids comment loss and unstable key order. Also removes the js-yaml dependency and slims the bundle |
| D3 | Layout (`position`) stays in the **same file** as the topology | Portability and simple file management take priority (Kazuki's decision). Diff noise is mitigated by deterministic serialization (D12) |
| D4 | Field names follow NetBox naming as a rule | Carries over the existing v7 format. Elements with no NetBox counterpart — `logical_links`, and `config_context` (which in NetBox is a computed value; the writable field is `local_context_data`) — are explicitly documented as "TopoDraft extensions" in the format spec |
| D5 | **NetBox sync is out of scope for the extension** | Delegated to AI agents using NetBox MCP / API. The extension carries no auth, conflict resolution, or version-difference logic. In exchange, the JSON Schema becomes the contract with agents (see format spec) |
| D6 | Undo/Redo is **fully delegated** to VSCode's document edit stack. The standalone version's internal snapshot history (150 entries) is removed | Dual history management always breaks. Webview edits are applied as `WorkspaceEdit`s; Ctrl+Z is left to standard VSCode behavior |
| D7 | The standalone HTML version is **frozen at v7**. The extension extracts core logic into a new pure-TypeScript package | No further maintenance of the standalone version. However, read compatibility with v3–v7 exports is preserved (→ golden files in the test strategy) |
| D8 | Marketplace publication is decided later, but the design is **publication-ready** so that publishing requires no major rework | Checklist in §9 is satisfied progressively from Phase 0 |
| D9 | Introduce `$schema` and `version` fields in the file (format v1) | Foundation for future migrations. Files without `version` (pre-v7 exports) are read as legacy and normalized on first save |
| D10 | Link references **stay name-based** (no stable IDs). In-editor rename auto-updates references; dangling references and duplicate names surface as Diagnostics (Problems panel) | Readability for humans and AI takes priority. Once issues appear in the Problems panel, agents can run a self-correction loop |
| D11 | Invalid-JSON resilience: while the document fails to parse, the canvas switches to a read-only error view and the Webview **never writes back**. It resumes automatically once the JSON is valid again | Prevents the editor from crashing on an agent's mid-edit state, and prevents overwriting (destroying) agent edits with a stale canvas state. The most important safety requirement |
| D12 | Deterministic serialization: identical content always produces byte-identical JSON output | Stable git diffs, reviewability, and stable diff-based agent edits. Rules are defined in format spec §4 |
| D13 | i18n moves to `vscode.l10n`, following the VSCode display language (en/ja bundled). The standalone version's in-app toggle is removed | Standard Marketplace practice. The existing STR dictionary (en/ja) ports over to l10n format |
| D14 | Keybinding redesign: the standalone version's Ctrl+K (command palette) is removed; all actions are registered as VSCode commands under the `TopoDraft: ...` namespace. Webview-internal shortcuts (Ctrl+C/V etc.) avoid collisions via focus conditions (`when` clauses) | Ctrl+K collides head-on with VSCode's chord prefix |

## 3. Non-goals

- Direct NetBox sync (pull/push) and NetBox credential management — delegated to AI agents
- YAML support (including `.topo.yaml`)
- Feature additions to the standalone HTML version (frozen at v7; no bug fixes either)
- Real-time collaborative editing
- PNG image export and freehand annotation (future candidates; when implemented, the agreed policy is that annotations are excluded from data exports)
- Anything like the old "Tidy" auto re-layout (removed in v6; do not resurrect). Only the initial auto-placement when opening a file without positions is implemented

## 4. Architecture

### 4.1 Repository layout (monorepo)

```
topodraft/
├── packages/
│   ├── core/                 # DOM-independent pure TS. The heart of the extension
│   │   ├── src/
│   │   │   ├── model.ts          # Type definitions (Device, Link, Topology, …)
│   │   │   ├── parse.ts          # JSON → model (legacy absorption / normalization)
│   │   │   ├── serialize.ts      # model → canonical JSON (D12)
│   │   │   ├── validate.ts       # semantic validation → Diagnostic array
│   │   │   ├── operations.ts     # pure functions: add/delete/rename (reference-following)/align, …
│   │   │   ├── geometry.ts       # anchor math, VRF compartments, straight-line offsets
│   │   │   └── generators/       # markdown / for-ai / schema / drawio
│   │   └── test/
│   ├── webview-ui/           # Canvas UI (ported from the v7 UI layer)
│   │   ├── src/              # rendering, interactions, panels. Depends only on core
│   │   └── test/
│   ├── extension/            # VSCode extension host
│   │   ├── src/
│   │   │   ├── extension.ts        # activate / command registration
│   │   │   ├── topoEditor.ts       # CustomTextEditorProvider
│   │   │   ├── diagnostics.ts      # publishes validate results to the Problems panel
│   │   │   └── commands/           # export commands, new file, templates
│   │   └── test/               # @vscode/test-electron integration tests
│   └── protocol/             # Webview ⇔ host message type definitions (shared)
├── schema/
│   └── topodraft.schema.json # JSON Schema for format v1 (published artifact)
├── fixtures/                 # golden files (v3–v7 real exports + v1 canonical forms)
├── docs/                     # this document set
└── .github/workflows/ci.yml
```

- Toolchain: TypeScript / esbuild bundling / vitest (core, webview-ui, protocol) / @vscode/test-electron (extension) / GitHub Actions
- The Webview **cannot use CDNs** (CSP). All assets are bundled. No UI framework: the v7 vanilla structure is ported as-is (minimal dependencies; diffs against the frozen version stay traceable)

### 4.2 Sync loop (CustomTextEditorProvider)

```
TextDocument (truth) ──(update: full text + docVersion)──▶ Webview
     ▲                                                       │
     └──(edit request: apply WorkspaceEdit)◀──(edit: new full text + baseVersion)
```

1. **Host → Webview**: on `onDidChangeTextDocument`, send the full text and `document.version`. The Webview runs `parse()`; on success it re-renders, on failure it enters the D11 error-view mode
2. **Webview → host**: whenever a canvas operation commits, the model is updated via core `operations`, then the `serialize()`d full text is sent along with the `baseVersion` the operation was based on. The host applies a `WorkspaceEdit` (full-text replace) **only if** `baseVersion` matches the current document version; otherwise the edit is discarded and the Webview waits for the latest update (prevents stale-state overwrites when racing with agent edits)
3. **Echo suppression**: the host records the version of edits it applied itself and flags the corresponding updates as "self-originated." On self-originated updates the Webview preserves selection and viewport
4. **Edit granularity**: start with full-text replacement; once stable, optimize to "compute minimal range edits by diffing the two serialized texts" (git-wise identical; improves VSCode's undo presentation and merge behavior). This is open question O1
5. **Undo granularity**: continuous operations (node drags, repeated arrow-key nudges) are committed **as a single edit on completion** (mouseup / 400ms debounce), mirroring the standalone version's `pushHistory` timing exactly

### 4.3 Where state lives

| State | Location |
| --- | --- |
| Topology + layout | The `.topo.json` document (truth) |
| Selection, viewport (pan/zoom), view toggles (Grid/Snap/Underlay/Global/viewMode) | Ephemeral Webview state. Do not use `retainContextWhenHidden`; restore across tab switches via `getState/setState` (O4) |
| User templates | **Decided (O2): plain `*.topo.json` files** in `topodraft.templatesFolder` (default `.topodraft/templates`), listed by the New File command and the toolbar ＋New menu. `globalState` is not used |
| Language | Follows the VSCode display language (D13). No custom setting |

### 4.4 Commands (initial set)

| Command | Behavior |
| --- | --- |
| `TopoDraft: New Topology File` | Pick a template → create and open a new `*.topo.json` |
| `TopoDraft: Export as Markdown / For AI / Import Schema / draw.io` | Invoke core generators; output to a new editor or file save (replaces the standalone Export tabs; a JSON tab is unnecessary — the file itself is the JSON) |
| `TopoDraft: Validate` | Run validate explicitly (normally automatic on edit) |
| `TopoDraft: Open as Text / Open in Topology Editor` | Convenience wrappers over `workbench.action.reopenWithEditor` |
| `TopoDraft: Save as Template` | Serializes the active topology into `topodraft.templatesFolder` (added with O2) |
| `TopoDraft: Write AI Agent Guide (AGENTS.md)` | Upserts the marker-delimited format contract (rules + schema + example) into the workspace's AGENTS.md; also on the toolbar (✨ AI Guide) with a Save-as option |

### 4.5 `package.json` contributions (essentials)

```jsonc
{
  "customEditors": [{
    "viewType": "topodraft.editor",
    "displayName": "TopoDraft Editor",
    "selector": [{ "filenamePattern": "*.topo.json" }],
    "priority": "default"
  }],
  "jsonValidation": [{
    "fileMatch": "*.topo.json",
    "url": "./schema/topodraft.schema.json"
  }],
  "activationEvents": []   // lazy activation via customEditor/commands only; "*" is forbidden
}
```

Thanks to `jsonValidation`, **schema validation and completion also apply while the file is open as text (i.e., while an AI agent edits it)**. This is the technical backbone of D5 (delegating NetBox integration to agents).

### 4.6 Diagnostics (semantic validation)

Checks that JSON Schema cannot express run in core `validate()` and are published to the Problems panel. Error locations resolve JSON paths to text ranges (via jsonc-parser).

Initial rule set:
- E: duplicate device / provider-network names
- E: dangling link endpoint references (nonexistent `device` / `provider_network`)
- W: `lag` refers to a parent interface that does not exist on the same device
- W: an endpoint `interface` does not exist on that device
- W: a `logical_links` endpoint `vrf` appears neither in the device's `vrfs[]` nor among interface-derived VRFs (the message explains the auto-derivation rule)
- I: missing `version` field (legacy format; note that saving will add it)

## 5. Port map from the standalone HTML version (v7)

| v7 feature | In the extension |
| --- | --- |
| Canvas rendering, physical/logical views, VRF compartments, 4-side anchors, straight links | Ported into webview-ui as-is (core math moves to core/geometry.ts) |
| Property panel, Config Context modal | Ported (Config Context is JSON-only, D2) |
| Export 6 tabs | JSON → removed (the file itself) / YAML → removed / Markdown, For AI, Schema, draw.io → become commands |
| Import | Removed (opening the file IS the import). Legacy-format absorption lives in parse.ts |
| Undo/Redo (internal 150-entry history) | Removed → delegated to VSCode (D6) |
| Ctrl+K command palette | Removed → VSCode commands (D14) |
| Templates (localStorage) | globalState + New File command (O2) |
| Language toggle (localStorage) | vscode.l10n (D13) |
| localStorage in general, Blob downloads, CDN | All removed (Webview constraints) |

## 6. Testing Strategy (mandatory requirement)

### 6.1 Principle — regression prevention

> **Every feature/change PR must (a) add tests for the new feature itself AND (b) keep the entire existing test suite green as a merge condition.** If existing tests must be modified or deleted, the PR description must state explicitly that this is a spec change, approved in review. Enforced via CI required status checks.

"Writing tests only for the new feature while skipping verification of existing behavior" is forbidden by mechanism, not convention. Locally, a single `npm test` must run every test in every package.

### 6.2 Test layers

| Layer | Tooling | Contents |
| --- | --- | --- |
| ① core unit | vitest | Model operations, reference-following rename, VRF derivation, anchor math, generators. **The standalone version's jsdom test suite (~30 cases accumulated across v2–v7) is ported first, forming the regression baseline for existing behavior** |
| ② Golden files (compatibility) | vitest + fixtures/ | Real v3/v4/v5/v6/v7 export JSONs as fixtures. Snapshot-compare `parse → normalize` results to **detect regressions in legacy-format read compatibility** (the centerpiece of this strategy). Every format change must add a fixture for the new version |
| ③ Serializer determinism | vitest | (a) `parse(serialize(m)) ≡ m` (round-trip equivalence), (b) re-running `serialize(parse(t))` yields a byte-identical string (idempotence), (c) key-order / newline / indentation rules |
| ④ validate/Diagnostics | vitest | Detection and non-detection per rule; JSON path → range resolution |
| ⑤ Protocol contract | vitest | Webview ⇔ host message types; discard-on-baseVersion-mismatch and echo-suppression logic (host logic separated from the VSCode API for pure-function testing) |
| ⑥ webview-ui | vitest + jsdom | Panel rendering, interaction handlers (same technique as the standalone tests) |
| ⑦ Integration (E2E) | @vscode/test-electron | Custom editor launch / canvas edit → document change → **Ctrl+Z triggers VSCode undo** / external (agent-simulated) text edit → canvas follows / invalid JSON → error view → recovery (D11) / editor does NOT launch for non-`.topo.json` JSON files |

### 6.3 CI

- GitHub Actions: on push/PR run lint → build → ①–⑥ → ⑦ (Linux; macOS/Windows may run pre-release only)
- Branch protection makes CI-green a merge requirement
- Coverage thresholds apply to the core package only (target ~80%). UI/integration are reviewed for scenario coverage rather than counts

### 6.4 Definition of Done (per feature PR)

- [ ] Unit tests for the new feature added
- [ ] If the format was touched: schema updated + golden fixture added + format spec revised
- [ ] Entire existing suite green (any modified existing tests are justified in the PR)
- [ ] Impact on Diagnostics and l10n (en/ja) checked
- [ ] CHANGELOG.md updated

## 7. Roadmap

| Phase | Contents | Exit criteria | Status |
| --- | --- | --- | --- |
| 0. Foundation | Monorepo scaffold / core extraction / **port standalone tests + build golden fixtures** / publish schema v1 / CI enforced | `npm test` all green. Fixtures guarantee v3–v7 read compatibility | ✅ done |
| 1. Viewer | CustomTextEditor renders `.topo.json` read-only. Follows text changes. Invalid-JSON resilience (D11). jsonValidation enabled | Canvas follows when an agent rewrites the file | ✅ done |
| 2. Editing | Canvas edits → WorkspaceEdit. Undo delegation. Rename reference-following. Panels, Config Context, context menu ported. Shortcut redesign | Feature parity with the standalone editor (minus YAML/Ctrl+K/internal undo). E2E green | ✅ done |
| 3. Periphery | Diagnostics / export commands / New File + templates / l10n (ja) | Agents can self-correct driven by the Problems panel | ✅ done |
| 4. Distribution | Private VSIX distribution / Marketplace readiness (§9) complete | Daily use starts from the `vsce package` artifact | ✅ VSIX in daily use; Marketplace items (publisher ID, LICENSE, icon) pending |
| Future | Marketplace publication decision / NetBox operations as MCP · Language Model Tools (separate project) / PNG & annotations | — |

## 8. Open questions (to be decided with Claude Code during implementation)

- **O1**: Whether/when to optimize Webview→host edits from full-text replacement to minimal range edits — within Phase 2, or later
- **O2**: ~~Where templates live~~ — **decided: file-based** (`topodraft.templatesFolder`, default `.topodraft/templates`); stronger for git management and sharing
- **O3**: The `$schema` URL — a versioned GitHub raw URL, or a relative path to the bundled copy (consider how it looks post-Marketplace)
- **O4**: Webview behavior when the tab is hidden — is `getState/setState` restoration sufficient, or do large diagrams need `retainContextWhenHidden` (weigh the memory cost)
- **O5**: Diagnostics severity tuning (especially the W/I boundary) — adjust with real-world feedback

## 9. Marketplace readiness checklist (D8: satisfied from the start)

- [ ] Obtain a publisher ID; fill in `package.json` name/displayName/description/categories/keywords
- [ ] LICENSE (decide whether to open-source; "all rights reserved" still allows publication for personal use)
- [ ] README (English-first, screenshots/GIFs) and CHANGELOG
- [ ] Icon (128px) and gallery banner
- [ ] Sensible `engines.vscode` floor / minimal activationEvents (lazy activation)
- [ ] esbuild-bundled, `.vscodeignore` curated for minimal VSIX size
- [ ] No remote code loading (guaranteed by the D2 CDN removal) / no telemetry (state the no-telemetry policy explicitly)
- [ ] Decide on vscode.dev (web VSCode) support — easy if core avoids Node APIs, so **write core browser-compatible from the start**
- [ ] Release automation (tag → CI → VSIX artifact; `vsce publish` stays a manual trigger)
- [ ] Pre-release channel policy

---

## Appendix A: Summary of spec differences vs. v7

| Item | Standalone HTML v7 | VSCode extension |
| --- | --- | --- |
| Source of truth | In-memory state | Text document |
| File | Any name via Export | `*.topo.json` (with `$schema`/`version`) |
| YAML | Supported (CDN-dependent) | Removed entirely |
| Undo | Internal 150-entry history | Delegated to VSCode |
| Commands | Ctrl+K palette | VSCode commands |
| Validation | Minimal, at import time | JSON Schema + Diagnostics, always on |
| i18n | In-app toggle | vscode.l10n (follows display language) |
| Templates / settings | localStorage | globalState / VSCode settings |
| NetBox integration | None | None (delegated to AI agents; the schema is the contract) |

---

## Appendix B: Post-plan decisions and intentional v7 deviations (implementation log)

Decisions made with the reviewer during implementation, in addition to the
ADRs above. The file-format side of these is normative in the format spec;
this table records the editor-behavior side.

| Date | Decision / deviation | Rationale |
| --- | --- | --- |
| 2026-07 | **O2 decided: file-based templates** (`topodraft.templatesFolder`, default `.topodraft/templates`); `Save as Template` writes there; built-ins use vendor-neutral names only | Git-manageable and shareable; no real service names in shipped defaults |
| 2026-07 | **Toolbar surfaces the common commands**: ＋New (template dropdown), Export dropdown, ✨ AI Guide | Features must be discoverable in the UI, not only the command palette |
| 2026-07 | **AGENTS.md agent guide**: marker-delimited idempotent upsert (`topodraft:agent-guide:begin/end`), toolbar dialog with append-notice and Save-as; guide includes creation rules (produce `*.topo.json`, not images; `$schema` skeleton) | Closes the agent-interop loop proactively (guide) + reactively (did-you-mean diagnostics) |
| 2026-07-05 | **`networks[]` multi-access segments** (format spec §3.10) with dedicated `fhrp` field and `{network}` endpoints; logical-view-only pill rendering; physical view untouched | Point-to-point-only logical view could not express HSRP/VRRP server segments |
| 2026-07-05 | **Deviation from v7 — segment link anchors**: link endpoints on segment pills intersect the rounded boundary (`roundedAnchor`), not the square bounding box | v7's rect anchor left endpoints floating up to ~20px outside the pill corners |
| 2026-07-05 | **Deviation from v7 — parallel-link bundles**: in the logical view, bundles are keyed by (node, VRF) anchor pair and never mix with the physical underlay; v7 keyed by node pair | Node-pair bundling shifted endpoints off their 20px VRF compartment rows once a device pair carried several VRFs |
| 2026-07-05 | **QuickPick is never triggered from webview messages**: the ＋New toolbar menu lives in the webview and passes a preselected template key; only the command-palette path shows a QuickPick | A QuickPick opened from a webview message is dismissed by the webview re-taking focus (microsoft/vscode#214787) |
| 2026-07-05 | **Stale-host detection**: one esbuild-defined build id in both bundles; the webview compares the host's `data-build` stamp and shows a persistent reload hint on mismatch | Reinstalling a same-version VSIX leaves the old extension host in memory while new webview assets load from disk |
| 2026-07-05 | **Collapsible properties panel** (strip button, persisted per editor; new selections re-open it) | Maximize canvas space on demand |
