/**
 * Editor application (Phase 2).
 *
 * The text document stays the source of truth (ADR D1): every canvas
 * operation mutates a local working model and, at v7's pushHistory moments
 * (mouseup, field change, 400ms nudge debounce — plan §4.2-5), serializes it
 * and asks the host to apply a WorkspaceEdit with the docVersion the state
 * was based on. Stale edits are discarded by the host; self-originated
 * update echoes are suppressed here. Undo/redo is VSCode's document history
 * (ADR D6) — Ctrl+Z is deliberately NOT handled in the webview (D14).
 *
 * While the text fails to parse, the last good canvas stays visible (dimmed)
 * under an error bar, editing is paused, and nothing is written back (D11).
 */
import type { Cable, Circuit, LogicalLink, Point, Topology } from '@topodraft/core';
import {
  GRID,
  NODE_H,
  NODE_W,
  addCable,
  addCircuit,
  addDevice,
  addLogicalLink,
  addProviderNetwork,
  alignCol,
  alignRow,
  anchor,
  autoLayout,
  deleteLink,
  deleteNodes,
  distributeH,
  distributeV,
  findDevice,
  logAnchor,
  makeClipboard,
  needsAutoLayout,
  parse,
  pasteClipboard as corePasteClipboard,
  renameDevice,
  renameProviderNetwork,
  renameSite,
  serialize,
  snap,
  vrfRowIndex,
  vrfRowRect,
} from '@topodraft/core';
import type { TopoClipboard } from '@topodraft/core';
import type { HostToWebviewMessage, WebviewToHostMessage } from '@topodraft/protocol';
import type { EditorApi, InlineRenameTarget, LinkRef } from './api';
import { linkRefKey, parseLinkRefKey } from './api';
import type { NodeVM, SceneDom, ViewMode, ViewOptions } from './scene';
import { buildNodes, displayTopology, renderScene, sceneBounds } from './scene';
import { renderPanel } from './panel';
import { createContextMenu } from './ctxmenu';
import { createConfigContextModal } from './modal';
import { buildPalette } from './palette';
import { T, fmt } from './strings';
import './styles.css';

export interface PersistedViewState {
  vt: { x: number; y: number; k: number };
  viewMode: ViewMode;
  underlayOn: boolean;
  showGlobal: boolean;
  gridOn: boolean;
  snapOn?: boolean;
}

/** Host abstraction so tests can drive the app without a real webview. */
export interface AppHost {
  postMessage(message: WebviewToHostMessage): void;
  getState(): PersistedViewState | undefined;
  setState(state: PersistedViewState): void;
}

export interface DocState {
  topology: Topology | null;
  parseError: string | null;
  docVersion: number;
}

const DEFAULT_VIEW: PersistedViewState = {
  vt: { x: 60, y: 40, k: 1 },
  viewMode: 'physical',
  underlayOn: true,
  showGlobal: true,
  gridOn: true,
  snapOn: true,
};

type DragState =
  | { mode: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { mode: 'marquee'; start: Point; cur?: Point }
  | { mode: 'node'; primary: string; offs: Map<string, { dx: number; dy: number }>; moved: boolean }
  | { mode: 'link'; from: string; fromVrf: string; hoverRow: string | null }
  | { mode: 'place'; role: string; at?: Point };

export interface App {
  handleMessage(message: HostToWebviewMessage): void;
  getDocState(): DocState;
  getView(): ViewOptions;
  getSelection(): { nodes: ReadonlySet<string>; link: LinkRef | null };
  fit(): void;
  api: EditorApi;
  dom: SceneDom & { app: HTMLElement; errorBar: HTMLElement; errorMsg: HTMLElement };
}

export function createApp(root: HTMLElement, host: AppHost): App {
  const persisted = host.getState();
  const view: ViewOptions = {
    vt: { ...(persisted?.vt ?? DEFAULT_VIEW.vt) },
    viewMode: persisted?.viewMode ?? DEFAULT_VIEW.viewMode,
    underlayOn: persisted?.underlayOn ?? DEFAULT_VIEW.underlayOn,
    showGlobal: persisted?.showGlobal ?? DEFAULT_VIEW.showGlobal,
    gridOn: persisted?.gridOn ?? DEFAULT_VIEW.gridOn,
  };
  let snapOn = persisted?.snapOn ?? true;

  let model: Topology | null = null;
  let parseError: string | null = null;
  let docVersion = -1;
  let sel = new Set<string>();
  let selLink: LinkRef | null = null;
  let clipboard: TopoClipboard | null = null;
  let pasteN = 0;
  let hoverNode: string | null = null;
  let hoverRow: string | null = null;
  let drag: DragState | null = null;
  let fittedOnce = false;
  let lastSyncedText: string | null = null;
  let lastSentText: string | null = null;
  let awaitingAck = false;
  let queuedCommit = false;
  let nudgeTimer: ReturnType<typeof setTimeout> | undefined;

  /* ---------- static DOM ---------- */
  root.innerHTML = `
    <div id="app">
      <div id="topbar">
        <div class="tb-seg" title="${T('tt_seg')}">
          <button id="btnPhys">${T('tb_phys')}</button>
          <button id="btnLogi">${T('tb_logi')}</button>
        </div>
        <button class="tb-btn" id="btnUnder" title="${T('tt_under')}">${T('tb_under')}</button>
        <button class="tb-btn" id="btnGlobal" title="${T('tt_global')}">${T('tb_global')}</button>
        <div class="tb-sep"></div>
        <button class="tb-btn" id="btnSnap" title="${T('tt_snap')}">${T('tb_snap')}</button>
        <button class="tb-btn" id="btnGrid" title="${T('tt_grid')}">${T('tb_grid')}</button>
        <button class="tb-btn" id="btnFit" title="${T('tt_fit')}">${T('tb_fit')}</button>
        <div class="spacer"></div>
      </div>
      <div id="main">
        <div id="palette"></div>
        <div id="canvasWrap">
          <svg id="svg">
            <defs>
              <pattern id="gridS" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 H 0 V 20" fill="none" stroke="#1A212B" stroke-width="1"/>
              </pattern>
              <pattern id="gridL" width="100" height="100" patternUnits="userSpaceOnUse">
                <path d="M 100 0 H 0 V 100" fill="none" stroke="#222B37" stroke-width="1"/>
              </pattern>
            </defs>
            <g id="world">
              <g id="lyGrid">
                <rect x="-20000" y="-20000" width="40000" height="40000" fill="url(#gridS)" pointer-events="none"/>
                <rect x="-20000" y="-20000" width="40000" height="40000" fill="url(#gridL)" pointer-events="none"/>
              </g>
              <g id="lySites"></g>
              <g id="lyLinks"></g>
              <g id="lyNodes"></g>
              <g id="lyLogi"></g>
              <g id="lyGuides"></g>
              <g id="lyTemp"></g>
            </g>
          </svg>
          <div id="errorBar"><span class="et">${T('err_invalid')}</span><span class="em"></span></div>
          <div id="emptyHint">${T('empty_hint')}</div>
          <div id="viewBadge">LOGICAL VIEW</div>
          <div id="vrfLegend"></div>
          <div id="zoomCtl">
            <button id="zoomOut" title="${T('tt_zoom_out')}">−</button>
            <button id="zoomReset" title="${T('tt_zoom_reset')}">⊙</button>
            <button id="zoomIn" title="${T('tt_zoom_in')}">＋</button>
          </div>
          <input id="inlineEdit" type="text" spellcheck="false">
        </div>
        <div id="panel"></div>
      </div>
      <div id="statusbar">
        <span id="stCounts">—</span>
        <span class="grow"></span>
        <span id="stZoom">100%</span>
      </div>
      <div id="toast"></div>
    </div>`;

  const $ = <T extends Element = HTMLElement>(sel2: string): T => {
    const found = root.querySelector(sel2);
    if (!found) throw new Error(`missing element ${sel2}`);
    return found as T;
  };
  const dom = {
    app: $('#app'),
    svg: $<SVGSVGElement>('#svg'),
    world: $<SVGGElement>('#world'),
    lyGrid: $<SVGGElement>('#lyGrid'),
    lySites: $<SVGGElement>('#lySites'),
    lyLinks: $<SVGGElement>('#lyLinks'),
    lyNodes: $<SVGGElement>('#lyNodes'),
    lyLogi: $<SVGGElement>('#lyLogi'),
    emptyHint: $('#emptyHint'),
    viewBadge: $('#viewBadge'),
    vrfLegend: $('#vrfLegend'),
    counts: $('#stCounts'),
    zoomPct: $('#stZoom'),
    errorBar: $('#errorBar'),
    errorMsg: $('#errorBar .em'),
  };
  const lyGuides = $<SVGGElement>('#lyGuides');
  const lyTemp = $<SVGGElement>('#lyTemp');
  const panelEl = $('#panel');
  const inlineEdit = $<HTMLInputElement>('#inlineEdit');
  const toastEl = $('#toast');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag: string, attrs: Record<string, string | number>): SVGElement => {
    const e = document.createElementNS(SVGNS, tag) as SVGElement;
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    return e;
  };

  /* ---------- basics ---------- */

  const editable = (): boolean => model !== null && parseError === null;

  const persist = (): void =>
    host.setState({
      vt: { ...view.vt },
      viewMode: view.viewMode,
      underlayOn: view.underlayOn,
      showGlobal: view.showGlobal,
      gridOn: view.gridOn,
      snapOn,
    });

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const toast = (message: string): void => {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1900);
  };

  const render = (): void => {
    dom.app.classList.toggle('invalid', parseError !== null);
    dom.errorBar.style.display = parseError !== null ? 'flex' : 'none';
    dom.errorMsg.textContent = parseError ?? '';
    syncToolbar();
    renderScene(dom, model, view, {
      selectedNodes: sel,
      selectedLink: selLink ? linkRefKey(selLink) : null,
      hoverNode,
      hoverRow,
      dropRow: drag?.mode === 'link' ? drag.hoverRow : null,
      linkDragging: drag?.mode === 'link',
    });
  };
  const renderPanelNow = (): void => renderPanel(panelEl, api);

  const syncToolbar = (): void => {
    $('#btnPhys').classList.toggle('on', view.viewMode === 'physical');
    $('#btnLogi').classList.toggle('on', view.viewMode === 'logical');
    ($('#btnUnder') as HTMLElement).style.display = view.viewMode === 'logical' ? '' : 'none';
    ($('#btnGlobal') as HTMLElement).style.display = view.viewMode === 'logical' ? '' : 'none';
    $('#btnUnder').classList.toggle('active', view.underlayOn);
    $('#btnGlobal').classList.toggle('active', view.showGlobal);
    $('#btnGrid').classList.toggle('active', view.gridOn);
    $('#btnSnap').classList.toggle('active', snapOn);
  };

  /* ---------- sync loop (webview side of plan §4.2) ---------- */

  const commit = (): void => {
    if (!editable()) return;
    const text = serialize(model as Topology);
    if (awaitingAck) {
      queuedCommit = true;
      return;
    }
    if (text === lastSyncedText) return;
    awaitingAck = true;
    lastSentText = text;
    host.postMessage({ type: 'edit', text, baseVersion: docVersion });
  };

  const pruneSelection = (): void => {
    if (!model) return;
    const names = new Set([
      ...model.devices.map((d) => d.name),
      ...(model.provider_networks ?? []).map((p) => p.name),
    ]);
    sel = new Set([...sel].filter((n) => names.has(n)));
    if (selLink && selLink.idx >= (model[selLink.col] ?? []).length) selLink = null;
  };

  const handleMessage = (message: HostToWebviewMessage): void => {
    if (message.type !== 'update') return;
    docVersion = message.docVersion;
    if (message.selfOriginated && message.text === lastSentText) {
      // our own edit coming back — already rendered optimistically
      lastSyncedText = message.text;
      awaitingAck = false;
      if (queuedCommit) {
        queuedCommit = false;
        commit();
      }
      return;
    }
    // external change (agent edit) — or a state we no longer track
    awaitingAck = false;
    queuedCommit = false;
    const hadModel = model !== null;
    try {
      model = parse(message.text);
      parseError = null;
      lastSyncedText = message.text;
    } catch (e) {
      parseError = (e as Error).message;
    }
    pruneSelection();
    render();
    renderPanelNow();
    if (!fittedOnce && !hadModel && model && persisted === undefined) {
      fittedOnce = true;
      fit();
    }
  };

  /* ---------- viewport ---------- */

  const canvasSize = (): { w: number; h: number } => {
    const r = dom.svg.getBoundingClientRect();
    return { w: r.width || 800, h: r.height || 600 };
  };

  const toWorld = (clientX: number, clientY: number): Point => {
    const r = dom.svg.getBoundingClientRect();
    return { x: (clientX - r.left - view.vt.x) / view.vt.k, y: (clientY - r.top - view.vt.y) / view.vt.k };
  };
  const toScreen = (wx: number, wy: number): Point => ({
    x: wx * view.vt.k + view.vt.x,
    y: wy * view.vt.k + view.vt.y,
  });

  const fit = (): void => {
    if (!model) return;
    const b = sceneBounds(model, view);
    if (!b) return;
    const { w, h } = canvasSize();
    const k = Math.min(2, Math.max(0.25, Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0))));
    view.vt.k = k;
    view.vt.x = (w - (b.x1 - b.x0) * k) / 2 - b.x0 * k;
    view.vt.y = (h - (b.y1 - b.y0) * k) / 2 - b.y0 * k;
    persist();
    render();
  };

  const zoomCenter = (f: number): void => {
    const { w, h } = canvasSize();
    const cx = w / 2;
    const cy = h / 2;
    const wx = (cx - view.vt.x) / view.vt.k;
    const wy = (cy - view.vt.y) / view.vt.k;
    view.vt.k = Math.min(2.5, Math.max(0.25, view.vt.k * f));
    view.vt.x = cx - wx * view.vt.k;
    view.vt.y = cy - wy * view.vt.k;
    persist();
    render();
  };

  /* ---------- position helpers ---------- */

  /**
   * Position-affecting edits on an auto-laid-out file first materialize the
   * layout into the model, so the committed document is self-consistent
   * (v7 wrote the layout at import; here it happens on the first spatial edit).
   */
  const ensurePositions = (): void => {
    if (model && needsAutoLayout(model)) model = autoLayout(model);
  };

  const nodePosition = (name: string): { x: number; y: number } | null => {
    if (!model) return null;
    const node =
      findDevice(model, name) ?? (model.provider_networks ?? []).find((p) => p.name === name);
    if (!node) return null;
    node.position = node.position ?? { x: 0, y: 0 };
    return node.position;
  };

  /* ---------- editor API (used by panel / menus / modal / palette) ---------- */

  const selectOnly = (name: string): void => {
    sel = new Set([name]);
    selLink = null;
    render();
    renderPanelNow();
  };

  const api: EditorApi = {
    model: () => model as Topology,
    editable,
    view: () => view,
    selectedNodes: () => sel,
    selectedLink: () => selLink,
    selectOnly,
    toggleSelect: (name) => {
      selLink = null;
      if (sel.has(name)) sel.delete(name);
      else sel.add(name);
      render();
      renderPanelNow();
    },
    setSelection: (names) => {
      sel = new Set(names);
      selLink = null;
      render();
      renderPanelNow();
    },
    selectLink: (ref) => {
      sel.clear();
      selLink = ref;
      render();
      renderPanelNow();
    },
    clearSelection: () => {
      if (!sel.size && !selLink) return;
      sel.clear();
      selLink = null;
      render();
      renderPanelNow();
    },
    selectAll: () => {
      if (!model) return;
      sel = new Set([
        ...model.devices.map((d) => d.name),
        ...(model.provider_networks ?? []).map((p) => p.name),
      ]);
      selLink = null;
      render();
      renderPanelNow();
    },
    mutate: (fn) => {
      if (!editable()) return;
      fn(model as Topology);
      render();
    },
    commit,
    apply: (op) => {
      if (!editable()) return;
      model = op(model as Topology);
      pruneSelection();
      render();
      renderPanelNow();
      commit();
    },
    renameNode: (oldName, newName) => {
      if (!editable() || !newName.trim() || oldName === newName) return;
      const fresh = newName.trim();
      const isDevice = findDevice(model as Topology, oldName) !== undefined;
      if (sel.delete(oldName)) sel.add(fresh);
      api.apply((t) =>
        isDevice ? renameDevice(t, oldName, fresh) : renameProviderNetwork(t, oldName, fresh),
      );
    },
    renameSite: (oldSite, newSite) => {
      if (oldSite === newSite) return;
      api.apply((t) => renameSite(t, oldSite, newSite));
    },
    render,
    renderPanel: renderPanelNow,
    toWorld,
    copySelection: () => {
      if (!editable() || !sel.size) return false;
      clipboard = makeClipboard(model as Topology, [...sel]);
      pasteN = 0;
      const links =
        clipboard.cables.length + clipboard.circuits.length + clipboard.logical_links.length;
      toast(
        fmt(T('t_copied'), {
          n: clipboard.devices.length + clipboard.provider_networks.length,
          m: links,
        }),
      );
      return true;
    },
    pasteClipboard: (at) => {
      if (!editable() || !clipboard) return;
      ensurePositions();
      const nodes = [...clipboard.devices, ...clipboard.provider_networks];
      if (!nodes.length) return;
      pasteN++;
      const minX = Math.min(...nodes.map((n) => n.position?.x ?? 0));
      const minY = Math.min(...nodes.map((n) => n.position?.y ?? 0));
      const bx = at ? at.x : minX + 32 * pasteN;
      const by = at ? at.y : minY + 32 * pasteN;
      const result = corePasteClipboard(model as Topology, clipboard, bx, by, snapOn);
      model = result.topology;
      sel = new Set(result.renames.values());
      selLink = null;
      render();
      renderPanelNow();
      commit();
    },
    duplicateSelection: () => {
      if (!editable() || !sel.size) return;
      const keep = clipboard;
      const keepN = pasteN;
      clipboard = makeClipboard(model as Topology, [...sel]);
      pasteN = 0;
      api.pasteClipboard();
      clipboard = keep;
      pasteN = keepN;
    },
    hasClipboard: () => clipboard !== null && clipboard.devices.length + clipboard.provider_networks.length > 0,
    deleteSelection: () => {
      if (!editable()) return;
      if (selLink) {
        const ref = selLink;
        selLink = null;
        api.apply((t) => deleteLink(t, ref.col, ref.idx));
      } else if (sel.size) {
        const names = [...sel];
        sel.clear();
        api.apply((t) => deleteNodes(t, names));
      }
    },
    addNodeAt: (role, wx, wy) => {
      if (!editable()) return;
      ensurePositions();
      const x = wx - NODE_W / 2;
      const y = wy - NODE_H / 2;
      const result =
        role === '__pn__'
          ? addProviderNetwork(model as Topology, x, y)
          : addDevice(model as Topology, role, x, y);
      model = result.topology;
      sel = new Set([result.name]);
      selLink = null;
      render();
      renderPanelNow();
      commit();
    },
    clearCanvas: () => {
      if (!editable()) return;
      const hasContent =
        (model as Topology).devices.length || ((model as Topology).provider_networks ?? []).length;
      if (!hasContent) return;
      sel.clear();
      selLink = null;
      api.apply((t) => {
        const next: Topology = { devices: [] };
        if (t.$schema !== undefined) next.$schema = t.$schema;
        if (t.version !== undefined) next.version = t.version;
        return next;
      });
      toast(T('t_cleared'));
    },
    arrange: (kind) => {
      if (!editable() || sel.size < 2) return;
      ensurePositions();
      const names = [...sel];
      const op = { row: alignRow, col: alignCol, dh: distributeH, dv: distributeV }[kind];
      api.apply((t) => op(t, names, snapOn));
    },
    openConfigContext: (name) => configModal.open(name),
    openInlineRename: (target) => openInline(target),
    toast,
  };

  /* ---------- inline rename (v7 dblclick) ---------- */

  let inlineTarget: InlineRenameTarget | null = null;
  const openInline = (target: InlineRenameTarget): void => {
    if (!editable()) return;
    inlineTarget = target;
    let value = '';
    if (target.type === 'node') {
      const vm = buildNodes(displayTopology(model as Topology), view).get(target.name);
      if (!vm) return;
      const p = toScreen(vm.x, vm.y);
      inlineEdit.style.left = p.x + 'px';
      inlineEdit.style.top = p.y + 'px';
      inlineEdit.style.width = NODE_W * view.vt.k + 'px';
      inlineEdit.style.height = 44 * view.vt.k + 'px';
      value = target.name;
    } else {
      inlineEdit.style.left = '20px';
      inlineEdit.style.top = '20px';
      inlineEdit.style.width = '180px';
      inlineEdit.style.height = '26px';
      value = target.site;
    }
    inlineEdit.value = value;
    inlineEdit.style.display = 'block';
    inlineEdit.focus();
    inlineEdit.select();
  };
  const commitInline = (): void => {
    if (!inlineTarget) return;
    const target = inlineTarget;
    inlineTarget = null;
    inlineEdit.style.display = 'none';
    const v = inlineEdit.value.trim();
    if (target.type === 'node') {
      if (v && v !== target.name) api.renameNode(target.name, v);
    } else if (v !== target.site) {
      api.renameSite(target.site, v);
    }
  };
  inlineEdit.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitInline();
    if (e.key === 'Escape') {
      inlineTarget = null;
      inlineEdit.style.display = 'none';
    }
    e.stopPropagation();
  });
  inlineEdit.addEventListener('blur', commitInline);

  /* ---------- sub-modules ---------- */

  const configModal = createConfigContextModal($('#canvasWrap'), api);
  const ctxMenu = createContextMenu(dom.app, api);
  buildPalette($('#palette'), api, {
    svgCenterWorld: () => {
      const { w, h } = canvasSize();
      return toWorld(w / 2, h / 2);
    },
    beginPlacement: (role) => {
      if (!editable()) return;
      drag = { mode: 'place', role };
    },
  });

  /* ---------- link creation helpers ---------- */

  const decideLinkKind = (a: NodeVM, b: NodeVM): 'cable' | 'circuit' | 'logical' => {
    if (view.viewMode === 'logical') return 'logical';
    if (a.kind === 'pn' || b.kind === 'pn') return 'circuit';
    return a.site && b.site && a.site !== b.site ? 'circuit' : 'cable';
  };

  const createLink = (fromName: string, fromVrf: string, toName: string, toVrf: string): void => {
    const nodes = buildNodes(displayTopology(model as Topology), view);
    const a = nodes.get(fromName);
    const b = nodes.get(toName);
    if (!a || !b) return;
    const kind = decideLinkKind(a, b);
    if (kind === 'logical') {
      const ep = (n: NodeVM, vrf: string): LogicalLink['a'] =>
        n.kind === 'pn'
          ? { provider_network: n.name }
          : { device: n.name, ...(vrf ? { vrf } : {}) };
      api.apply((t) => addLogicalLink(t, { a: ep(a, fromVrf), b: ep(b, toVrf) }));
      api.selectLink({ col: 'logical_links', idx: ((model as Topology).logical_links ?? []).length - 1 });
      toast(
        fmt(T('t_log_link'), {
          a: a.name,
          va: fromVrf || T('t_global_word'),
          b: b.name,
          vb: toVrf || T('t_global_word'),
        }),
      );
    } else {
      const ep = (n: NodeVM): Cable['a'] =>
        n.kind === 'pn' ? { provider_network: n.name } : { device: n.name };
      if (kind === 'circuit') {
        api.apply((t) => addCircuit(t, { a: ep(a), b: ep(b) } as Circuit));
        api.selectLink({ col: 'circuits', idx: ((model as Topology).circuits ?? []).length - 1 });
        toast(T('t_circuit'));
      } else {
        api.apply((t) => addCable(t, { a: ep(a), b: ep(b) } as Cable));
        api.selectLink({ col: 'cables', idx: ((model as Topology).cables ?? []).length - 1 });
        toast(T('t_cable'));
      }
    }
  };

  /* ---------- canvas interactions (ported v7 handlers) ---------- */

  dom.svg.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      const r = dom.svg.getBoundingClientRect();
      const wx = (e.clientX - r.left - view.vt.x) / view.vt.k;
      const wy = (e.clientY - r.top - view.vt.y) / view.vt.k;
      const k2 = Math.min(2.5, Math.max(0.25, view.vt.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      view.vt.x = e.clientX - r.left - wx * k2;
      view.vt.y = e.clientY - r.top - wy * k2;
      view.vt.k = k2;
      persist();
      render();
    },
    { passive: false },
  );

  dom.svg.addEventListener('mousedown', (e: MouseEvent) => {
    ctxMenu.hide();
    const t = e.target as Element;
    const vport = t.closest('[data-vrfport]');
    const port = vport ? null : t.closest('[data-port]');
    const nodeG = port || vport ? null : t.closest('[data-node]');
    const linkG = t.closest('[data-link]');
    const canEdit = editable();
    if (e.button === 1 || (e.button === 0 && !port && !vport && !nodeG && !linkG)) {
      if (e.button === 0 && e.shiftKey && canEdit) {
        drag = { mode: 'marquee', start: toWorld(e.clientX, e.clientY) };
      } else {
        if (e.button === 0 && canEdit) api.clearSelection();
        drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, ox: view.vt.x, oy: view.vt.y };
        dom.svg.classList.add('panning');
      }
      e.preventDefault();
      return;
    }
    if (e.button !== 0 || !canEdit) return;
    if (vport) {
      drag = {
        mode: 'link',
        from: vport.getAttribute('data-vrfport') as string,
        fromVrf: vport.getAttribute('data-vrfname') ?? '',
        hoverRow: null,
      };
      dom.svg.classList.add('linking');
      e.preventDefault();
      return;
    }
    if (port) {
      drag = { mode: 'link', from: port.getAttribute('data-port') as string, fromVrf: '', hoverRow: null };
      dom.svg.classList.add('linking');
      e.preventDefault();
      return;
    }
    if (nodeG) {
      const name = nodeG.getAttribute('data-node') as string;
      if (e.shiftKey) {
        api.toggleSelect(name);
      } else {
        if (!sel.has(name)) selectOnly(name);
        ensurePositions();
        const w = toWorld(e.clientX, e.clientY);
        const offs = new Map<string, { dx: number; dy: number }>();
        for (const n of sel) {
          const p = nodePosition(n);
          if (p) offs.set(n, { dx: w.x - p.x, dy: w.y - p.y });
        }
        drag = { mode: 'node', primary: name, offs, moved: false };
      }
      e.preventDefault();
      return;
    }
    if (linkG) {
      const ref = parseLinkRefKey(linkG.getAttribute('data-link') as string);
      if (ref) api.selectLink(ref);
    }
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!drag) {
      if (!editable()) return;
      const t = e.target as Element | null;
      const g = t?.closest?.('[data-node],[data-port],[data-vrfport]') ?? null;
      const nid = g
        ? (g.getAttribute('data-node') ?? g.getAttribute('data-port') ?? g.getAttribute('data-vrfport'))
        : null;
      const rEl = t?.closest?.('[data-vrfrow],[data-vrfport]') ?? null;
      const rk = rEl
        ? `${rEl.getAttribute('data-vrfrow') ?? rEl.getAttribute('data-vrfport')}|${rEl.getAttribute('data-vrfname') ?? ''}`
        : null;
      if (nid !== hoverNode || rk !== hoverRow) {
        hoverNode = nid;
        hoverRow = rk;
        render();
      }
      return;
    }
    if (drag.mode === 'pan') {
      view.vt.x = drag.ox + (e.clientX - drag.sx);
      view.vt.y = drag.oy + (e.clientY - drag.sy);
      render();
    } else if (drag.mode === 'marquee') {
      const w = toWorld(e.clientX, e.clientY);
      drag.cur = w;
      lyGuides.textContent = '';
      lyGuides.appendChild(
        svgEl('rect', {
          class: 'marquee',
          x: Math.min(drag.start.x, w.x),
          y: Math.min(drag.start.y, w.y),
          width: Math.abs(w.x - drag.start.x),
          height: Math.abs(w.y - drag.start.y),
        }),
      );
    } else if (drag.mode === 'node') {
      const prim = nodePosition(drag.primary);
      const off = drag.offs.get(drag.primary);
      if (!prim || !off || !model) return;
      const w = toWorld(e.clientX, e.clientY);
      let nx = snap(w.x - off.dx, snapOn);
      let ny = snap(w.y - off.dy, snapOn);
      /* alignment guides against unselected nodes (v7) */
      lyGuides.textContent = '';
      const th = 6 / view.vt.k;
      let gx: number | null = null;
      let gy: number | null = null;
      const vms = buildNodes(displayTopology(model), view);
      const primVm = vms.get(drag.primary);
      const primH = primVm?.h ?? NODE_H;
      for (const o of vms.values()) {
        if (sel.has(o.name)) continue;
        const ocx = o.x + NODE_W / 2;
        const ocy = o.y + o.h / 2;
        if (Math.abs(nx + NODE_W / 2 - ocx) <= th) {
          nx = ocx - NODE_W / 2;
          gx = ocx;
        }
        if (Math.abs(ny + primH / 2 - ocy) <= th) {
          ny = ocy - primH / 2;
          gy = ocy;
        }
      }
      if (gx !== null) lyGuides.appendChild(svgEl('line', { class: 'guide', x1: gx, y1: -1e5, x2: gx, y2: 1e5 }));
      if (gy !== null) lyGuides.appendChild(svgEl('line', { class: 'guide', x1: -1e5, y1: gy, x2: 1e5, y2: gy }));
      const ddx = nx - prim.x;
      const ddy = ny - prim.y;
      if (ddx || ddy) {
        for (const n of sel) {
          const p = nodePosition(n);
          if (p) {
            p.x += ddx;
            p.y += ddy;
          }
        }
        drag.moved = true;
        render();
      }
    } else if (drag.mode === 'link') {
      const t = e.target as Element | null;
      const rowEl = t?.closest?.('[data-vrfport],[data-vrfrow]') ?? null;
      const hk = rowEl
        ? `${rowEl.getAttribute('data-vrfport') ?? rowEl.getAttribute('data-vrfrow')}|${rowEl.getAttribute('data-vrfname') ?? ''}`
        : null;
      if (hk !== drag.hoverRow) {
        drag.hoverRow = hk;
        render();
      }
      const w = toWorld(e.clientX, e.clientY);
      const vms = buildNodes(displayTopology(model as Topology), view);
      const from = vms.get(drag.from);
      lyTemp.textContent = '';
      if (from) {
        // anchor from the compartment in the logical view, else the node body
        let p: Point | null = null;
        if (view.viewMode === 'logical' && from.kind === 'device') {
          const rowIdx = vrfRowIndex(from.rows, drag.fromVrf, view.showGlobal);
          if (rowIdx >= 0) p = logAnchor(vrfRowRect(from.x, from.y, rowIdx), w.x, w.y);
        }
        p = p ?? anchor(from.x, from.y, NODE_W, from.h, w.x, w.y);
        lyTemp.appendChild(svgEl('path', { class: 'templink', d: `M ${p.x} ${p.y} L ${w.x} ${w.y}` }));
      }
    } else if (drag.mode === 'place') {
      const w = toWorld(e.clientX, e.clientY);
      drag.at = w;
      lyTemp.textContent = '';
      lyTemp.appendChild(
        svgEl('rect', {
          class: 'place-ghost',
          x: w.x - NODE_W / 2,
          y: w.y - NODE_H / 2,
          width: NODE_W,
          height: NODE_H,
          rx: 9,
        }),
      );
    }
  });

  window.addEventListener('mouseup', (e: MouseEvent) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    dom.svg.classList.remove('panning', 'linking');
    lyGuides.textContent = '';
    lyTemp.textContent = '';
    if (d.mode === 'pan') {
      persist();
      return;
    }
    if (d.mode === 'node') {
      if (d.moved) commit();
      render();
      return;
    }
    if (d.mode === 'marquee' && d.cur) {
      const x0 = Math.min(d.start.x, d.cur.x);
      const x1 = Math.max(d.start.x, d.cur.x);
      const y0 = Math.min(d.start.y, d.cur.y);
      const y1 = Math.max(d.start.y, d.cur.y);
      if (model) {
        const vms = buildNodes(displayTopology(model), view);
        const names = [...sel];
        for (const vm of vms.values()) {
          if (vm.x < x1 && vm.x + NODE_W > x0 && vm.y < y1 && vm.y + vm.h > y0) names.push(vm.name);
        }
        api.setSelection(names);
      }
      render();
      return;
    }
    if (d.mode === 'link') {
      const t = e.target as Element | null;
      const vpG = t?.closest?.('[data-vrfport],[data-vrfrow]') ?? null;
      const nG = t?.closest?.('[data-node],[data-port]') ?? null;
      let toName: string | null = null;
      let toVrf = '';
      if (vpG) {
        toName = vpG.getAttribute('data-vrfport') ?? vpG.getAttribute('data-vrfrow');
        toVrf = vpG.getAttribute('data-vrfname') ?? '';
      } else if (nG) {
        toName = nG.getAttribute('data-node') ?? nG.getAttribute('data-port');
      }
      if (toName && toName !== d.from) createLink(d.from, d.fromVrf, toName, toVrf);
      render();
      return;
    }
    if (d.mode === 'place') {
      const t = e.target as Node | null;
      if (d.at && t && dom.svg.contains(t)) {
        api.addNodeAt(d.role, d.at.x, d.at.y);
      } else {
        render();
      }
    }
  });

  dom.svg.addEventListener('dblclick', (e: MouseEvent) => {
    if (!editable()) return;
    const t = e.target as Element;
    const nodeG = t.closest('[data-node]');
    const siteL = t.closest('[data-site]');
    if (nodeG) {
      openInline({ type: 'node', name: nodeG.getAttribute('data-node') as string });
    } else if (siteL) {
      openInline({ type: 'site', site: siteL.getAttribute('data-site') as string });
    }
  });

  dom.svg.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    if (!editable()) return;
    const t = e.target as Element;
    const nodeG = t.closest('[data-node]');
    const linkG = t.closest('[data-link]');
    if (nodeG) {
      ctxMenu.open(e.clientX, e.clientY, { kind: 'node', name: nodeG.getAttribute('data-node') as string });
    } else if (linkG) {
      const ref = parseLinkRefKey(linkG.getAttribute('data-link') as string);
      if (ref) ctxMenu.open(e.clientX, e.clientY, { kind: 'link', ref });
    } else {
      const w = toWorld(e.clientX, e.clientY);
      ctxMenu.open(e.clientX, e.clientY, { kind: 'canvas', wx: w.x, wy: w.y });
    }
  });

  /* ---------- keyboard (D14: no Ctrl+K; undo/redo belongs to VSCode) ---------- */

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const tag = (document.activeElement as Element | null)?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (typing) return;
    // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y fall through untouched: VSCode performs
    // document undo/redo and the canvas follows the resulting update (D6).
    if (mod && (key === 'z' || key === 'y')) return;
    if (e.key === 'Escape') {
      ctxMenu.hide();
      configModal.close();
      api.clearSelection();
      return;
    }
    if (!editable()) return;
    if (mod && key === 'c') {
      if (api.copySelection()) e.preventDefault();
      return;
    }
    if (mod && key === 'v') {
      e.preventDefault();
      api.pasteClipboard();
      return;
    }
    if (mod && key === 'd') {
      e.preventDefault();
      api.duplicateSelection();
      return;
    }
    if (mod && key === 'a') {
      e.preventDefault();
      api.selectAll();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      api.deleteSelection();
      return;
    }
    if (sel.size && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      ensurePositions();
      const step = e.altKey ? 1 : GRID;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      for (const n of sel) {
        const p = nodePosition(n);
        if (p) {
          p.x += dx;
          p.y += dy;
        }
      }
      render();
      clearTimeout(nudgeTimer);
      // continuous nudges collapse into ONE document edit (plan §4.2-5)
      nudgeTimer = setTimeout(() => commit(), 400);
    }
  });

  /* ---------- toolbar ---------- */

  const setViewMode = (mode: ViewMode): void => {
    view.viewMode = mode;
    if (selLink && mode === 'physical' && selLink.col === 'logical_links') selLink = null;
    persist();
    render();
    renderPanelNow();
  };
  $('#btnPhys').addEventListener('click', () => setViewMode('physical'));
  $('#btnLogi').addEventListener('click', () => setViewMode('logical'));
  $('#btnUnder').addEventListener('click', () => {
    view.underlayOn = !view.underlayOn;
    persist();
    render();
  });
  $('#btnGlobal').addEventListener('click', () => {
    view.showGlobal = !view.showGlobal;
    persist();
    render();
  });
  $('#btnGrid').addEventListener('click', () => {
    view.gridOn = !view.gridOn;
    persist();
    render();
  });
  $('#btnSnap').addEventListener('click', () => {
    snapOn = !snapOn;
    persist();
    render();
    toast(snapOn ? T('t_snap_on') : T('t_snap_off'));
  });
  $('#btnFit').addEventListener('click', fit);
  $('#zoomIn').addEventListener('click', () => zoomCenter(1.2));
  $('#zoomOut').addEventListener('click', () => zoomCenter(1 / 1.2));
  $('#zoomReset').addEventListener('click', () => zoomCenter(1 / view.vt.k));

  render();
  renderPanelNow();
  host.postMessage({ type: 'ready' });

  return {
    handleMessage,
    getDocState: () => ({ topology: model, parseError, docVersion }),
    getView: () => view,
    getSelection: () => ({ nodes: sel, link: selLink }),
    fit,
    api,
    dom,
  };
}
