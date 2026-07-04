/**
 * Read-only viewer application (Phase 1).
 *
 * The text document is the source of truth (ADR D1): the host pushes the full
 * text on every change; this app parses and re-renders, preserving the
 * viewport. While the text fails to parse, the last good canvas stays visible
 * (dimmed) under an error bar and nothing is ever written back (ADR D11).
 */
import type { Topology } from '@topodraft/core';
import { parse } from '@topodraft/core';
import type { HostToWebviewMessage, WebviewToHostMessage } from '@topodraft/protocol';
import type { SceneDom, ViewMode, ViewOptions } from './scene';
import { renderScene, sceneBounds } from './scene';
import './styles.css';

export interface PersistedViewState {
  vt: { x: number; y: number; k: number };
  viewMode: ViewMode;
  underlayOn: boolean;
  showGlobal: boolean;
  gridOn: boolean;
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
};

/** Pure D11 document-state transition — unit-tested directly. */
export function applyUpdate(prev: DocState, text: string, docVersion: number): DocState {
  try {
    return { topology: parse(text), parseError: null, docVersion };
  } catch (e) {
    // keep the last good topology; surface the error
    return { topology: prev.topology, parseError: (e as Error).message, docVersion };
  }
}

export interface App {
  handleMessage(message: HostToWebviewMessage): void;
  getDocState(): DocState;
  getView(): ViewOptions;
  fit(): void;
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
  let doc: DocState = { topology: null, parseError: null, docVersion: -1 };
  let fittedOnce = false;

  /* ---------- static DOM ---------- */
  root.innerHTML = `
    <div id="app">
      <div id="topbar">
        <div class="tb-seg" title="Physical view: cables &amp; circuits. Logical view: VRF instances inside devices.">
          <button id="btnPhys">Physical</button>
          <button id="btnLogi">Logical</button>
        </div>
        <button class="tb-btn" id="btnUnder" title="Underlay — show the physical links faintly under the logical view">Underlay</button>
        <button class="tb-btn" id="btnGlobal" title="Global — show/hide the global-routing-table compartments">Global</button>
        <div class="tb-sep"></div>
        <button class="tb-btn" id="btnGrid" title="Grid lines">Grid</button>
        <button class="tb-btn" id="btnFit" title="Fit view — zoom to show everything">Fit</button>
        <div class="spacer"></div>
        <span class="ro-badge" title="Editing arrives in a later phase — edit the JSON as text meanwhile">READ-ONLY VIEWER</span>
      </div>
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
          </g>
        </svg>
        <div id="errorBar"><span class="et">Invalid JSON</span><span class="em"></span></div>
        <div id="emptyHint">No devices in this file<br><b>Edit the JSON as text</b> to add some — the canvas follows</div>
        <div id="viewBadge">LOGICAL VIEW</div>
        <div id="vrfLegend"></div>
        <div id="zoomCtl">
          <button id="zoomOut" title="Zoom out">−</button>
          <button id="zoomReset" title="Zoom to 100%">⊙</button>
          <button id="zoomIn" title="Zoom in">＋</button>
        </div>
      </div>
      <div id="statusbar">
        <span id="stCounts">—</span>
        <span class="grow"></span>
        <span id="stZoom">100%</span>
      </div>
    </div>`;

  const $ = <T extends Element = HTMLElement>(sel: string): T => {
    const found = root.querySelector(sel);
    if (!found) throw new Error(`missing element ${sel}`);
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

  /* ---------- rendering ---------- */
  const persist = (): void =>
    host.setState({
      vt: { ...view.vt },
      viewMode: view.viewMode,
      underlayOn: view.underlayOn,
      showGlobal: view.showGlobal,
      gridOn: view.gridOn,
    });

  const render = (): void => {
    dom.app.classList.toggle('invalid', doc.parseError !== null);
    dom.errorBar.style.display = doc.parseError !== null ? 'flex' : 'none';
    dom.errorMsg.textContent = doc.parseError ?? '';
    syncToolbar();
    renderScene(dom, doc.topology, view);
  };

  const syncToolbar = (): void => {
    $('#btnPhys').classList.toggle('on', view.viewMode === 'physical');
    $('#btnLogi').classList.toggle('on', view.viewMode === 'logical');
    ($('#btnUnder') as HTMLElement).style.display = view.viewMode === 'logical' ? '' : 'none';
    ($('#btnGlobal') as HTMLElement).style.display = view.viewMode === 'logical' ? '' : 'none';
    $('#btnUnder').classList.toggle('active', view.underlayOn);
    $('#btnGlobal').classList.toggle('active', view.showGlobal);
    $('#btnGrid').classList.toggle('active', view.gridOn);
  };

  /* ---------- viewport (ported v7 fit/zoom/pan) ---------- */
  const canvasSize = (): { w: number; h: number } => {
    const r = dom.svg.getBoundingClientRect();
    // jsdom and pre-layout calls report 0×0 — fall back to a sane size
    return { w: r.width || 800, h: r.height || 600 };
  };

  const fit = (): void => {
    if (!doc.topology) return;
    const b = sceneBounds(doc.topology, view);
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

  let pan: { sx: number; sy: number; ox: number; oy: number } | null = null;
  dom.svg.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    pan = { sx: e.clientX, sy: e.clientY, ox: view.vt.x, oy: view.vt.y };
    dom.svg.classList.add('panning');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!pan) return;
    view.vt.x = pan.ox + (e.clientX - pan.sx);
    view.vt.y = pan.oy + (e.clientY - pan.sy);
    render();
  });
  window.addEventListener('mouseup', () => {
    if (!pan) return;
    pan = null;
    dom.svg.classList.remove('panning');
    persist();
  });

  /* ---------- toolbar ---------- */
  const setViewMode = (mode: ViewMode): void => {
    view.viewMode = mode;
    persist();
    render();
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
  $('#btnFit').addEventListener('click', fit);
  $('#zoomIn').addEventListener('click', () => zoomCenter(1.2));
  $('#zoomOut').addEventListener('click', () => zoomCenter(1 / 1.2));
  $('#zoomReset').addEventListener('click', () => zoomCenter(1 / view.vt.k));

  /* ---------- host messages ---------- */
  const handleMessage = (message: HostToWebviewMessage): void => {
    if (message.type !== 'update') return;
    const hadTopology = doc.topology !== null;
    doc = applyUpdate(doc, message.text, message.docVersion);
    render();
    // fit once on the first successful parse (v7 fits after import); later
    // updates preserve the viewport — including agent edits (plan §4.2)
    if (!fittedOnce && !hadTopology && doc.topology && persisted === undefined) {
      fittedOnce = true;
      fit();
    }
  };

  render();
  host.postMessage({ type: 'ready' });

  return {
    handleMessage,
    getDocState: () => doc,
    getView: () => view,
    fit,
    dom,
  };
}
