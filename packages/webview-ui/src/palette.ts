/**
 * Node palette (left sidebar). Clicking adds the node at the view center;
 * press-and-drag onto the canvas places it under the cursor (v7 used HTML5
 * drag-and-drop; a mouse-driven drag behaves identically and works in
 * every webview).
 */
import { iconKey } from '@topodraft/core';
import type { EditorApi } from './api';
import { NODE_ROLES } from './ctxmenu';
import { ICONS, ROLE_COLOR } from './icons';

const SUBTITLE: Record<string, string> = {
  router: 'router',
  switch: 'switch',
  firewall: 'firewall',
  external_peer: 'external_peer',
  server: 'server',
  __pn__: 'provider_network',
  '': '(no role)',
};

export function buildPalette(
  container: HTMLElement,
  api: EditorApi,
  canvas: { svgCenterWorld(): { x: number; y: number }; beginPlacement(role: string): void },
): void {
  container.innerHTML = '<div class="pal-title">Nodes</div>';
  for (const t of NODE_ROLES) {
    const d = document.createElement('div');
    d.className = 'pal-item';
    const key = t.role === '__pn__' ? 'pnet' : iconKey(t.role);
    d.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[key]}</svg>
      <div><div class="pl">${t.label}</div><div class="ps">${SUBTITLE[t.role] ?? ''}</div></div>`;
    (d.firstChild as SVGElement).style.stroke = ROLE_COLOR[key];
    d.setAttribute('data-pal-role', t.role);
    d.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      canvas.beginPlacement(t.role);
    });
    container.appendChild(d);
  }
  const hint = document.createElement('div');
  hint.className = 'pal-hint';
  hint.innerHTML =
    'Drag onto the canvas to place.<br>Connect: drag from a <b>◦ port</b> shown on hover.<br><kbd>Shift</kbd>+click / drag: multi-select';
  container.appendChild(hint);
}
