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
    topology: {
      $schema: 'https://raw.githubusercontent.com/kazukifujiwara/network-topo-draft/main/schema/topodraft.schema.json',
      version: 1,
      devices: [],
    },
  },
  {
    id: 'two-site-wan',
    label: '2-site redundant WAN',
    description: 'Two sites, redundant carrier circuits',
    topology: {
      $schema: 'https://raw.githubusercontent.com/kazukifujiwara/network-topo-draft/main/schema/topodraft.schema.json',
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
          position: { x: 400, y: 60 },
        },
        {
          name: 'rt-tokyo-02',
          role: 'router',
          site: 'Tokyo-HQ',
          interfaces: [{ name: 'Gi0/0/0', ip_address: '10.255.0.5/30', description: 'WAN #2' }],
          position: { x: 400, y: 190 },
        },
        {
          name: 'sw-tokyo-01',
          role: 'switch',
          site: 'Tokyo-HQ',
          // declared so the template opens diagnostic-clean (v7's data referenced
          // this interface from the cable without declaring it)
          interfaces: [{ name: 'Gi1/0/49', description: 'to rt-tokyo-01' }],
          position: { x: 170, y: 120 },
        },
        {
          name: 'rt-osaka-01',
          role: 'router',
          site: 'Osaka-DC',
          interfaces: [{ name: 'Gi0/0/0', ip_address: '10.255.0.2/30', description: 'WAN #1' }],
          position: { x: 810, y: 60 },
        },
        {
          name: 'rt-osaka-02',
          role: 'router',
          site: 'Osaka-DC',
          interfaces: [{ name: 'Gi0/0/0', ip_address: '10.255.0.6/30', description: 'WAN #2' }],
          position: { x: 810, y: 190 },
        },
        { name: 'sw-osaka-01', role: 'switch', site: 'Osaka-DC', position: { x: 1040, y: 120 } },
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
      $schema: 'https://raw.githubusercontent.com/kazukifujiwara/network-topo-draft/main/schema/topodraft.schema.json',
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
  {
    id: 'hsrp-segment',
    label: 'Gateway pair + segment (HSRP)',
    description: 'Two gateways sharing a /28 multi-access segment with an HSRP virtual IP',
    topology: {
      $schema: 'https://raw.githubusercontent.com/kazukifujiwara/network-topo-draft/main/schema/topodraft.schema.json',
      version: 1,
      devices: [
        {
          name: 'rt-gw-01',
          role: 'router',
          site: 'HQ',
          interfaces: [
            { name: 'Vlan100', ip_address: '10.0.0.2/28', description: 'gateway (hsrp active)' },
          ],
          position: { x: 250, y: 60 },
        },
        {
          name: 'rt-gw-02',
          role: 'router',
          site: 'HQ',
          interfaces: [
            { name: 'Vlan100', ip_address: '10.0.0.3/28', description: 'gateway (hsrp standby)' },
          ],
          position: { x: 690, y: 60 },
        },
        { name: 'sw-01', role: 'switch', site: 'HQ', position: { x: 470, y: 210 } },
        {
          name: 'srv-01',
          role: 'server',
          site: 'HQ',
          interfaces: [{ name: 'eth0', ip_address: '10.0.0.10/28' }],
          position: { x: 470, y: 360 },
        },
      ],
      networks: [
        {
          name: 'seg-svc-01',
          prefix: '10.0.0.0/28',
          vlan: '100',
          fhrp: { protocol: 'hsrp', group_id: '1', virtual_ip: '10.0.0.1/28' },
          position: { x: 470, y: 60 },
        },
      ],
      cables: [
        { a: { device: 'rt-gw-01' }, b: { device: 'sw-01' }, type: 'cat6', status: 'connected' },
        { a: { device: 'rt-gw-02' }, b: { device: 'sw-01' }, type: 'cat6', status: 'connected' },
        { a: { device: 'srv-01' }, b: { device: 'sw-01' }, type: 'cat6', status: 'connected' },
      ],
      logical_links: [
        { a: { device: 'rt-gw-01', interface: 'Vlan100' }, b: { network: 'seg-svc-01' } },
        { a: { device: 'rt-gw-02', interface: 'Vlan100' }, b: { network: 'seg-svc-01' } },
        { a: { device: 'srv-01', interface: 'eth0' }, b: { network: 'seg-svc-01' } },
      ],
    },
  },
  {
    id: 'lag-pair',
    label: 'Routed LAG pair',
    description: 'Two routers uplinked to a switch pair over 2-member LAGs (lag interface examples)',
    topology: {
      $schema: 'https://raw.githubusercontent.com/kazukifujiwara/network-topo-draft/main/schema/topodraft.schema.json',
      version: 1,
      devices: [
        {
          name: 'rt-dc-01',
          role: 'router',
          site: 'DC',
          interfaces: [
            { name: 'Po1', ip_address: '10.0.0.1/30', type: 'lag', description: 'LAG to core-sw-01' },
            { name: 'Gi0/0/1', type: '1000base-t', lag: 'Po1' },
            { name: 'Gi0/0/2', type: '1000base-t', lag: 'Po1' },
          ],
          position: { x: 250, y: 60 },
        },
        {
          name: 'rt-dc-02',
          role: 'router',
          site: 'DC',
          interfaces: [
            { name: 'Po1', ip_address: '10.0.0.5/30', type: 'lag', description: 'LAG to core-sw-02' },
            { name: 'Gi0/0/1', type: '1000base-t', lag: 'Po1' },
            { name: 'Gi0/0/2', type: '1000base-t', lag: 'Po1' },
          ],
          position: { x: 690, y: 60 },
        },
        {
          name: 'core-sw-01',
          role: 'switch',
          site: 'DC',
          interfaces: [
            { name: 'Po10', type: 'lag', description: 'LAG to core-sw-02' },
            { name: 'Te1/0/1', type: '10gbase-x-sfpp', lag: 'Po10' },
            { name: 'Te1/0/2', type: '10gbase-x-sfpp', lag: 'Po10' },
            { name: 'Po1', type: 'lag', description: 'LAG to rt-dc-01' },
            { name: 'Te1/0/3', type: '10gbase-x-sfpp', lag: 'Po1' },
            { name: 'Te1/0/4', type: '10gbase-x-sfpp', lag: 'Po1' },
          ],
          position: { x: 250, y: 210 },
        },
        {
          name: 'core-sw-02',
          role: 'switch',
          site: 'DC',
          interfaces: [
            { name: 'Po10', type: 'lag', description: 'LAG to core-sw-01' },
            { name: 'Te1/0/1', type: '10gbase-x-sfpp', lag: 'Po10' },
            { name: 'Te1/0/2', type: '10gbase-x-sfpp', lag: 'Po10' },
            { name: 'Po1', type: 'lag', description: 'LAG to rt-dc-02' },
            { name: 'Te1/0/3', type: '10gbase-x-sfpp', lag: 'Po1' },
            { name: 'Te1/0/4', type: '10gbase-x-sfpp', lag: 'Po1' },
          ],
          position: { x: 690, y: 210 },
        },
      ],
      cables: [
        {
          a: { device: 'core-sw-01', interface: 'Po10' },
          b: { device: 'core-sw-02', interface: 'Po10' },
          bandwidth: '2x10G LAG',
          status: 'connected',
          label: 'Po10',
        },
        {
          a: { device: 'core-sw-01', interface: 'Po1' },
          b: { device: 'rt-dc-01', interface: 'Po1' },
          bandwidth: '2x1G LAG',
          status: 'connected',
          label: 'Po1',
        },
        {
          a: { device: 'core-sw-02', interface: 'Po1' },
          b: { device: 'rt-dc-02', interface: 'Po1' },
          bandwidth: '2x1G LAG',
          status: 'connected',
          label: 'Po1',
        },
      ],
    },
  },
];

/** Canonical file text for a builtin template. */
export function templateText(template: BuiltinTemplate): string {
  return serialize(template.topology);
}
