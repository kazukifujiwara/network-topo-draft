/**
 * Right-click context menu, ported from v7 (minus Ctrl+K hints — ADR D14).
 */
import { convertCableToCircuit, convertCircuitToCable, findDevice } from '@topodraft/core';
import type { EditorApi, LinkRef } from './api';
import { ICONS, ROLE_COLOR } from './icons';
import { iconKey } from '@topodraft/core';
import { T, fmt } from './strings';
import type { StringKey } from './strings';

export const NODE_ROLES: { role: string; labelKey: StringKey }[] = [
  { role: 'router', labelKey: 'pal_router' },
  { role: 'switch', labelKey: 'pal_switch' },
  { role: 'firewall', labelKey: 'pal_firewall' },
  { role: 'external_peer', labelKey: 'pal_extpeer' },
  { role: 'server', labelKey: 'pal_server' },
  { role: '__pn__', labelKey: 'pal_pn' },
  { role: '__network__', labelKey: 'pal_networkseg' },
  { role: '', labelKey: 'pal_generic' },
];

export type CtxTarget =
  | { kind: 'node'; name: string }
  | { kind: 'link'; ref: LinkRef }
  | { kind: 'canvas'; wx: number; wy: number };

export function createContextMenu(container: HTMLElement, api: EditorApi) {
  const menu = document.createElement('div');
  menu.id = 'ctxMenu';
  container.appendChild(menu);

  const hide = (): void => {
    menu.style.display = 'none';
  };
  document.addEventListener('mousedown', (e) => {
    if (!menu.contains(e.target as Node)) hide();
  });

  const item = (label: string, fn: () => void, opts?: { danger?: boolean }): void => {
    const d = document.createElement('div');
    d.className = 'ci' + (opts?.danger ? ' danger' : '');
    d.textContent = label;
    d.addEventListener('click', () => {
      hide();
      fn();
    });
    menu.appendChild(d);
  };
  const sep = (): void => {
    const s = document.createElement('div');
    s.className = 'csep';
    menu.appendChild(s);
  };
  const label = (text: string): void => {
    const l = document.createElement('div');
    l.className = 'clabel';
    l.textContent = text;
    menu.appendChild(l);
  };

  const open = (clientX: number, clientY: number, target: CtxTarget): void => {
    if (!api.editable()) return;
    menu.innerHTML = '';
    if (target.kind === 'node') {
      if (!api.selectedNodes().has(target.name)) api.selectOnly(target.name);
      const selected = api.selectedNodes();
      if (selected.size > 1) {
        label(fmt(T('cm_selected'), { n: selected.size }));
        item(T('copy'), () => api.copySelection());
        item(T('dup'), () => api.duplicateSelection());
        sep();
        item(T('cm_align_row'), () => api.arrange('row'));
        item(T('cm_align_col'), () => api.arrange('col'));
        item(T('cm_dist_h'), () => api.arrange('dh'));
        item(T('cm_dist_v'), () => api.arrange('dv'));
        sep();
        item(fmt(T('cm_del_n'), { n: selected.size }), () => api.deleteSelection(), { danger: true });
      } else {
        const device = findDevice(api.model(), target.name);
        item(T('cm_rename'), () => api.openInlineRename({ type: 'node', name: target.name }));
        item(T('copy'), () => api.copySelection());
        item(T('dup'), () => api.duplicateSelection());
        if (device) {
          item(T('cm_cc'), () => api.openConfigContext(target.name));
          sep();
          label(T('cm_role'));
          const row = document.createElement('div');
          row.className = 'roles';
          for (const rt of NODE_ROLES.filter((r) => !r.role.startsWith('__'))) {
            const b = document.createElement('button');
            const key = iconKey(rt.role);
            b.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[key]}</svg>`;
            (b.firstChild as SVGElement).style.stroke = ROLE_COLOR[key];
            b.title = T(rt.labelKey);
            b.addEventListener('click', (ev) => {
              ev.stopPropagation();
              hide();
              api.mutate((m) => {
                const d = findDevice(m, target.name);
                if (d) {
                  if (rt.role) d.role = rt.role;
                  else delete d.role;
                }
              });
              api.commit();
              api.renderPanel();
            });
            row.appendChild(b);
          }
          menu.appendChild(row);
        }
        sep();
        item(T('del'), () => api.deleteSelection(), { danger: true });
      }
    } else if (target.kind === 'link') {
      api.selectLink(target.ref);
      const link = (api.model()[target.ref.col] ?? [])[target.ref.idx];
      const hasPn =
        link !== undefined &&
        (link.a.provider_network !== undefined || link.b.provider_network !== undefined);
      if (target.ref.col === 'cables') {
        item(T('cm_to_circuit'), () => {
          const ref = target.ref;
          api.apply((m) => convertCableToCircuit(m, ref.idx));
          api.selectLink({ col: 'circuits', idx: (api.model().circuits ?? []).length - 1 });
        });
      } else if (target.ref.col === 'circuits' && !hasPn) {
        item(T('cm_to_cable'), () => {
          const ref = target.ref;
          api.apply((m) => convertCircuitToCable(m, ref.idx));
          api.selectLink({ col: 'cables', idx: (api.model().cables ?? []).length - 1 });
        });
      }
      sep();
      item(T('del_link'), () => api.deleteSelection(), { danger: true });
    } else {
      label(T('cm_add_here'));
      for (const rt of NODE_ROLES) {
        item(T(rt.labelKey), () => api.addNodeAt(rt.role, target.wx, target.wy));
      }
      if (api.hasClipboard()) {
        sep();
        item(T('cm_paste'), () => api.pasteClipboard({ x: target.wx, y: target.wy }));
      }
      sep();
      item(T('cm_select_all'), () => api.selectAll());
      item(T('clear_canvas'), () => api.clearCanvas(), { danger: true });
    }
    menu.style.display = 'block';
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    menu.style.left = Math.min(clientX, window.innerWidth - mw - 8) + 'px';
    menu.style.top = Math.min(clientY, window.innerHeight - mh - 8) + 'px';
  };

  return { open, hide, element: menu };
}
