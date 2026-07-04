/**
 * Markdown export (ported from v7 `genMarkdown`) — a human-readable
 * configuration document made of tables.
 *
 * Deviation from v7 (approved): the "Generated:" date is injectable via
 * options so the output is deterministic under test; it defaults to today.
 */

import type { LogicalEndpoint, PhysicalEndpoint, Topology } from '../model';
import { sitesList } from '../model';
import { toCanonical } from '../serialize';

export interface MarkdownOptions {
  /** ISO date (YYYY-MM-DD) for the "Generated:" line; defaults to today. */
  date?: string;
}

function mdTable(headers: string[], rows: (string | undefined)[][]): string {
  if (!rows.length) return '_none_\n';
  const h = '| ' + headers.join(' | ') + ' |';
  const s = '|' + headers.map(() => ' --- ').join('|') + '|';
  const b = rows
    .map(
      (r) =>
        '| ' +
        r.map((c) => String(c ?? '').replace(/\|/g, '\\|') || '—').join(' | ') +
        ' |',
    )
    .join('\n');
  return h + '\n' + s + '\n' + b + '\n';
}

function epStr(e: (PhysicalEndpoint & LogicalEndpoint) | undefined): string {
  if (!e) return '';
  if (e.provider_network) {
    return ['PN: ' + e.provider_network, e.id ? 'id:' + e.id : ''].filter(Boolean).join(' / ');
  }
  return [
    e.site,
    e.device,
    e.vrf ? '[' + e.vrf + ']' : '',
    e.id ? 'id:' + e.id : '',
    e.interface,
    e.ip_address,
  ]
    .filter(Boolean)
    .join(' / ');
}

export function genMarkdown(topology: Topology, options?: MarkdownOptions): string {
  const d = toCanonical(topology);
  const date = options?.date ?? new Date().toISOString().slice(0, 10);
  const linkCount =
    (d.cables?.length ?? 0) + (d.circuits?.length ?? 0) + (d.logical_links?.length ?? 0);
  let md = `# Network Configuration\n\nGenerated: ${date} · ${d.devices.length} devices · ${linkCount} links · ${sitesList(d).length} sites\n\n`;
  md +=
    '## Devices\n\n' +
    mdTable(
      ['name', 'role', 'site', 'tenant', 'vrfs', 'device_type', 'platform'],
      d.devices.map((x) => [
        x.name,
        x.role,
        x.site,
        x.tenant,
        (x.vrfs ?? []).join(', '),
        x.device_type,
        x.platform,
      ]),
    ) +
    '\n';
  if (d.provider_networks) {
    md +=
      '## Provider Networks\n\n' +
      mdTable(
        ['name', 'provider', 'description'],
        d.provider_networks.map((p) => [p.name, p.provider, p.description]),
      ) +
      '\n';
  }
  const ifRows: (string | undefined)[][] = [];
  d.devices.forEach((x) =>
    (x.interfaces ?? []).forEach((f) =>
      ifRows.push([x.name, f.name, f.ip_address, f.vrf, f.lag, f.type, f.description]),
    ),
  );
  md +=
    '## Interfaces\n\n' +
    mdTable(['device', 'interface', 'ip_address', 'vrf', 'lag', 'type', 'description'], ifRows) +
    '\n';
  md +=
    '## Local Connections (Cables)\n\n' +
    mdTable(
      ['A', 'B', 'type', 'bandwidth', 'status', 'label'],
      (d.cables ?? []).map((c) => [epStr(c.a), epStr(c.b), c.type, c.bandwidth, c.status, c.label]),
    ) +
    '\n';
  md +=
    '## Carrier Circuits\n\n' +
    mdTable(
      ['cid', 'provider', 'type', 'commit_rate', 'status', 'A', 'B'],
      (d.circuits ?? []).map((c) => [
        c.cid,
        c.provider,
        c.type,
        c.commit_rate,
        c.status,
        epStr(c.a),
        epStr(c.b),
      ]),
    ) +
    '\n';
  md +=
    '## Logical Links (L3 / VRF)\n\n' +
    mdTable(
      ['link_id', 'vlan', 'A (device [vrf] if)', 'B (device [vrf] if)', 'label', 'description'],
      (d.logical_links ?? []).map((c) => [
        c.link_id,
        c.vlan,
        epStr(c.a),
        epStr(c.b),
        c.label,
        c.description,
      ]),
    );
  const ccDevs = d.devices.filter((x) => x.config_context);
  if (ccDevs.length) {
    md += '\n## Config Contexts\n\n';
    ccDevs.forEach((x) => {
      md +=
        '### ' + x.name + '\n\n```json\n' + JSON.stringify(x.config_context, null, 2) + '\n```\n\n';
    });
  }
  return md;
}
