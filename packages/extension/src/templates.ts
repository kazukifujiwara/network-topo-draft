/**
 * Built-in topology templates for the New File command, ported from the v7
 * BUILTIN_TPLS. User templates are plain *.topo.json files in the configured
 * templates folder (O2 ruling: file-based — git-shareable, agent-editable).
 */
import type { Topology } from '@topodraft/core';
import { serialize } from '@topodraft/core';

export interface BuiltinTemplate {
  id: string;
  /** untranslated label; the command localizes at display time */
  label: string;
  description: string;
  topology: Topology;
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'empty',
    label: 'Empty topology',
    description: 'A blank canvas',
    topology: { version: 1, devices: [] },
  },
  {
    id: 'two-site-wan',
    label: '2-site redundant WAN',
    description: 'Two sites, redundant carrier circuits',
    topology: {
      version: 1,
      devices: [
        {
          name: 'rt-tokyo-01',
          role: 'router',
          site: 'Tokyo-HQ',
          interfaces: [
            { name: 'Gi0/0/0', ip_address: '10.255.0.1/30', description: 'WAN #1' },
            { name: 'Gi0/0/1', description: 'to sw' },
          ],
          position: { x: 60, y: 60 },
        },
        {
          name: 'rt-tokyo-02',
          role: 'router',
          site: 'Tokyo-HQ',
          interfaces: [{ name: 'Gi0/0/0', ip_address: '10.255.0.5/30', description: 'WAN #2' }],
          position: { x: 300, y: 60 },
        },
        {
          name: 'sw-tokyo-01',
          role: 'switch',
          site: 'Tokyo-HQ',
          // declared so the template opens diagnostic-clean (v7's data referenced
          // this interface from the cable without declaring it)
          interfaces: [{ name: 'Gi1/0/49', description: 'to rt-tokyo-01' }],
          position: { x: 180, y: 210 },
        },
        {
          name: 'rt-osaka-01',
          role: 'router',
          site: 'Osaka-DC',
          interfaces: [{ name: 'Gi0/0/0', ip_address: '10.255.0.2/30', description: 'WAN #1' }],
          position: { x: 780, y: 60 },
        },
        {
          name: 'rt-osaka-02',
          role: 'router',
          site: 'Osaka-DC',
          interfaces: [{ name: 'Gi0/0/0', ip_address: '10.255.0.6/30', description: 'WAN #2' }],
          position: { x: 1020, y: 60 },
        },
        { name: 'sw-osaka-01', role: 'switch', site: 'Osaka-DC', position: { x: 900, y: 210 } },
      ],
      cables: [
        {
          a: { device: 'rt-tokyo-01', interface: 'Gi0/0/1' },
          b: { device: 'sw-tokyo-01', interface: 'Gi1/0/49' },
          type: 'cat6',
          status: 'connected',
        },
        { a: { device: 'rt-tokyo-02' }, b: { device: 'sw-tokyo-01' }, type: 'cat6', status: 'connected' },
        { a: { device: 'rt-osaka-01' }, b: { device: 'sw-osaka-01' }, type: 'cat6', status: 'connected' },
        { a: { device: 'rt-osaka-02' }, b: { device: 'sw-osaka-01' }, type: 'cat6', status: 'connected' },
      ],
      circuits: [
        {
          a: { site: 'Tokyo-HQ', device: 'rt-tokyo-01', interface: 'Gi0/0/0' },
          b: { site: 'Osaka-DC', device: 'rt-osaka-01', interface: 'Gi0/0/0' },
          cid: 'CID-0001',
          provider: 'Carrier-A',
          type: 'leased line',
          commit_rate: '1Gbps',
          status: 'active',
        },
        {
          a: { site: 'Tokyo-HQ', device: 'rt-tokyo-02', interface: 'Gi0/0/0' },
          b: { site: 'Osaka-DC', device: 'rt-osaka-02', interface: 'Gi0/0/0' },
          cid: 'CID-0002',
          provider: 'Carrier-B',
          type: 'IP-VPN',
          commit_rate: '1Gbps',
          status: 'active',
        },
      ],
    },
  },
  {
    id: 'site-cloud',
    label: 'Site + cloud (VRF logical)',
    description: 'HQ connected to a cloud peer over a dedicated interconnect, logical VRF link',
    topology: {
      version: 1,
      devices: [
        {
          name: 'rt-hq-01',
          role: 'router',
          site: 'HQ',
          vrfs: ['PROD'],
          interfaces: [
            { name: 'Gi0/0/0', description: 'to interconnect' },
            {
              name: 'Gi0/0/0.100',
              ip_address: '169.254.10.1/30',
              type: 'virtual',
              description: 'Interconnect VIF',
              vrf: 'PROD',
            },
          ],
          position: { x: 120, y: 60 },
        },
        { name: 'fw-hq-01', role: 'firewall', site: 'HQ', position: { x: 120, y: 210 } },
        { name: 'sw-hq-01', role: 'switch', site: 'HQ', position: { x: 120, y: 360 } },
        { name: 'cloud-gw-01', role: 'external_peer', site: 'Cloud', position: { x: 820, y: 60 } },
      ],
      provider_networks: [
        {
          name: 'Cloud Interconnect',
          provider: 'ExampleNet',
          description: 'Interconnect location: colo-01',
          position: { x: 470, y: 60 },
        },
      ],
      cables: [
        { a: { device: 'rt-hq-01' }, b: { device: 'fw-hq-01' }, type: 'cat6', status: 'connected' },
        { a: { device: 'fw-hq-01' }, b: { device: 'sw-hq-01' }, type: 'cat6', status: 'connected' },
      ],
      circuits: [
        {
          a: { site: 'HQ', device: 'rt-hq-01', interface: 'Gi0/0/0' },
          b: { provider_network: 'Cloud Interconnect' },
          cid: 'IC-CID-01',
          provider: 'ExampleNet',
          type: 'dedicated interconnect',
          commit_rate: '1Gbps',
          status: 'active',
        },
        {
          a: { provider_network: 'Cloud Interconnect' },
          b: { site: 'Cloud', device: 'cloud-gw-01' },
          type: 'cloud-side interconnect',
          status: 'active',
        },
      ],
      logical_links: [
        {
          a: { device: 'rt-hq-01', vrf: 'PROD', interface: 'Gi0/0/0.100' },
          b: { device: 'cloud-gw-01', id: 'attach-01' },
          link_id: 'vif-0001',
          label: 'eBGP over interconnect VIF',
        },
      ],
    },
  },
];

/** Canonical file text for a builtin template. */
export function templateText(template: BuiltinTemplate): string {
  return serialize(template.topology);
}
