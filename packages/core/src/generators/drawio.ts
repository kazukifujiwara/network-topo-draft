/**
 * draw.io / diagrams.net export (ported from v7 `genDrawio`).
 *
 * Node order is devices then provider_networks; link order is cables →
 * circuits → logical_links (the order a v7 instance holds after an import),
 * so cell ids are deterministic.
 *
 * Deviation from v7 (consequence of preserving dangling links in parse):
 * edges whose endpoints do not resolve to a drawn node are skipped — v7
 * never held such links because it dropped them at import.
 */

import type { LogicalLink, Topology } from '../model';
import { deriveDeviceVrfs, iconKey, siteOf } from '../model';
import { NODE_H, NODE_W, vrfColor } from '../geometry';
import { toCanonical } from '../serialize';

const FILL: Record<string, string> = {
  router: '#dae8fc',
  switch: '#d5e8d4',
  firewall: '#ffe6cc',
  cloud: '#e1d5e7',
  server: '#d0f0f0',
  generic: '#f5f5f5',
  pnet: '#fff2cc',
};

function xmlEscape(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function logicalVrfOf(l: LogicalLink): string {
  const a = (l.a.vrf ?? '').trim();
  const b = (l.b.vrf ?? '').trim();
  return a || b;
}

export function genDrawio(topology: Topology): string {
  const d = toCanonical(topology);
  const x = xmlEscape;
  let id = 1;
  const cells: string[] = [];

  /* site frames (devices only; provider networks have no site) */
  const groups: Record<string, { x: number; y: number }[]> = {};
  for (const dev of d.devices) {
    const s = siteOf(dev);
    if (s) (groups[s] = groups[s] ?? []).push(dev.position ?? { x: 0, y: 0 });
  }
  for (const s in groups) {
    const ps = groups[s] as { x: number; y: number }[];
    const PAD = 26;
    const x0 = Math.min(...ps.map((p) => p.x)) - PAD;
    const y0 = Math.min(...ps.map((p) => p.y)) - PAD - 12;
    const w = Math.max(...ps.map((p) => p.x + NODE_W)) + PAD - x0;
    const h = Math.max(...ps.map((p) => p.y + NODE_H)) + PAD - y0;
    cells.push(
      `<mxCell id="s${++id}" value="${x(s)}" style="rounded=1;dashed=1;fillColor=none;strokeColor=#8899AA;verticalAlign=top;align=left;spacing=8;fontColor=#8899AA;" vertex="1" parent="1"><mxGeometry x="${x0}" y="${y0}" width="${w}" height="${h}" as="geometry"/></mxCell>`,
    );
  }

  /* nodes: devices then provider networks */
  const idOf: Record<string, string> = {};
  for (const dev of d.devices) {
    const k = iconKey(dev.role);
    const nodeId = 'n' + ++id;
    if (!(dev.name in idOf)) idOf[dev.name] = nodeId;
    const vrfs = deriveDeviceVrfs(d, dev.name);
    const sub = [dev.role, vrfs.length ? 'vrf: ' + vrfs.join(',') : '']
      .filter(Boolean)
      .join(' · ');
    const label = x(dev.name) + (sub ? `&#10;${x(sub)}` : '');
    const p = dev.position ?? { x: 0, y: 0 };
    cells.push(
      `<mxCell id="${nodeId}" value="${label}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=${FILL[k]};strokeColor=#666666;" vertex="1" parent="1"><mxGeometry x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" as="geometry"/></mxCell>`,
    );
  }
  for (const pn of d.provider_networks ?? []) {
    const nodeId = 'n' + ++id;
    if (!(pn.name in idOf)) idOf[pn.name] = nodeId;
    const sub = pn.provider || 'provider net';
    const label = x(pn.name) + `&#10;${x(sub)}`;
    const p = pn.position ?? { x: 0, y: 0 };
    cells.push(
      `<mxCell id="${nodeId}" value="${label}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=${FILL.pnet};strokeColor=#666666;dashed=1;" vertex="1" parent="1"><mxGeometry x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" as="geometry"/></mxCell>`,
    );
  }

  /* edges */
  const endId = (ep: { device?: string; provider_network?: string }): string | undefined =>
    idOf[ep.provider_network ?? ep.device ?? ''];
  const edge = (a: string, b: string, style: string, label: string): void => {
    cells.push(
      `<mxCell id="e${++id}" value="${x(label)}" style="${style}html=1;" edge="1" parent="1" source="${a}" target="${b}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
    );
  };
  for (const l of d.cables ?? []) {
    const a = endId(l.a);
    const b = endId(l.b);
    if (!a || !b) continue;
    edge(a, b, 'endArrow=none;strokeColor=#666666;', [l.label, l.type, l.bandwidth].filter(Boolean).join(' '));
  }
  for (const l of d.circuits ?? []) {
    const a = endId(l.a);
    const b = endId(l.b);
    if (!a || !b) continue;
    edge(
      a,
      b,
      'endArrow=none;dashed=1;strokeColor=#9673a6;strokeWidth=2;',
      [l.cid, l.provider].filter(Boolean).join(' '),
    );
  }
  for (const l of d.logical_links ?? []) {
    const a = endId(l.a);
    const b = endId(l.b);
    if (!a || !b) continue;
    edge(
      a,
      b,
      `endArrow=none;dashed=1;dashPattern=1 4;strokeColor=${vrfColor(logicalVrfOf(l))};strokeWidth=2;`,
      [l.link_id, l.label].filter(Boolean).join(' · '),
    );
  }

  return `<mxfile host="TopoDraft"><diagram name="topology"><mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram></mxfile>`;
}
