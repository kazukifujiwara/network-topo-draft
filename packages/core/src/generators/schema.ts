/**
 * The format-v1 JSON Schema (draft-07) and the "Schema" export document for
 * AI agents (ported from v7 `genSchema`).
 *
 * `topoJsonSchema` is the single source of truth for the published artifact
 * `schema/topodraft.schema.json`; a test asserts the two never drift.
 *
 * Deviations from v7 (approved rulings, see plan/format spec):
 * - `$schema` / `version` top-level fields added (ADR D9)
 * - `additionalProperties: false` on endpoint definitions too (spec §5)
 * - the document prose no longer mentions YAML or the Import button (ADR D2;
 *   opening the file in VSCode IS the import)
 */

export const topoJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Network TopoDraft topology (*.topo.json, format v1)',
  description:
    'File format v1 of Network TopoDraft. Normative specification: docs/topodraft-file-format-v1.md. Revision: 2026-07-04.',
  type: 'object',
  required: ['version', 'devices'],
  additionalProperties: false,
  definitions: {
    position: {
      type: 'object',
      description:
        'canvas coordinates; editor metadata with no network meaning. OPTIONAL — omit to auto-arrange on open',
      required: ['x', 'y'],
      additionalProperties: false,
      properties: { x: { type: 'number' }, y: { type: 'number' } },
    },
    endpoint: {
      description: 'Physical link endpoint: {site?, device, interface?} or {provider_network}.',
      oneOf: [
        {
          type: 'object',
          required: ['device'],
          additionalProperties: false,
          properties: {
            site: { type: 'string', description: "informational; the device's site" },
            device: { type: 'string', description: 'device name (must match devices[].name)' },
            interface: { type: 'string', description: 'interface name on that device' },
          },
        },
        {
          type: 'object',
          required: ['provider_network'],
          additionalProperties: false,
          properties: {
            provider_network: {
              type: 'string',
              description: 'provider network name (must match provider_networks[].name)',
            },
          },
        },
      ],
    },
    logical_endpoint: {
      description:
        'Logical link endpoint: a routing instance on a device. vrf omitted/empty = global routing table.',
      oneOf: [
        {
          type: 'object',
          required: ['device'],
          additionalProperties: false,
          properties: {
            device: { type: 'string', description: 'device name (must match devices[].name)' },
            vrf: {
              type: 'string',
              description: 'VRF instance on that device; omit for the global routing table',
            },
            id: {
              type: 'string',
              description:
                'environment / attachment identifier when the VRF name is unknown (tenant ID, VIF/VC ID …); drawn next to the endpoint',
            },
            interface: {
              type: 'string',
              description:
                'interface used by this adjacency (typically a subinterface, e.g. Gi0/0/1.100)',
            },
            ip_address: {
              type: 'string',
              description:
                "endpoint IP (CIDR). If 'interface' is set, prefer putting the IP on that interface in devices[] — the editor normalizes an interface+ip_address pair by writing the IP onto the device-side interface.",
            },
          },
        },
        {
          type: 'object',
          required: ['provider_network'],
          additionalProperties: false,
          properties: {
            provider_network: { type: 'string' },
            id: {
              type: 'string',
              description: 'attachment / VC identifier on the provider network',
            },
          },
        },
      ],
    },
  },
  properties: {
    $schema: {
      type: 'string',
      description: 'optional, recommended: URL of this schema',
    },
    version: {
      const: 1,
      description:
        'file format version; fixed to 1. Files without it are read as legacy exports and normalized on save',
    },
    devices: {
      type: 'array',
      description: 'network devices (≈ NetBox Device)',
      items: {
        type: 'object',
        required: ['name'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'hostname; UNIQUE — referenced by links' },
          device_type: { type: 'string', description: "vendor + model, e.g. 'Cisco C8300'" },
          role: {
            type: 'string',
            description: 'free text, e.g. router / switch / firewall / external_peer',
          },
          site: {
            type: 'string',
            description: 'location grouping; same value = drawn in the same site frame',
          },
          tenant: { type: 'string', description: 'owning organization' },
          platform: { type: 'string', description: "OS, e.g. 'IOS-XE 17.12'" },
          vrfs: {
            type: 'array',
            items: { type: 'string' },
            description:
              'VRF routing instances configured on this device; shown as compartments in the logical view',
          },
          interfaces: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: {
                  type: 'string',
                  description: 'e.g. Gi0/0/1, subinterface Gi0/0/1.100, LAG parent Po1',
                },
                ip_address: { type: 'string', description: 'CIDR, e.g. 10.0.0.1/30' },
                type: { type: 'string', description: 'e.g. 1000base-t, lag, virtual' },
                description: { type: 'string' },
                lag: {
                  type: 'string',
                  description: 'name of the parent LAG interface on the SAME device (e.g. Po1)',
                },
                vrf: { type: 'string', description: 'VRF this interface belongs to' },
              },
            },
          },
          config_context: {
            type: 'object',
            description:
              'free-form structured settings for the device (routing, BGP, policies …) — any JSON object; stored and re-exported as-is, never drawn on the canvas',
          },
          position: { $ref: '#/definitions/position' },
        },
      },
    },
    provider_networks: {
      type: 'array',
      description:
        'carrier-side networks: AWS Direct Connect, OCI FastConnect, IP-VPN cloud … (≈ NetBox Provider Network)',
      items: {
        type: 'object',
        required: ['name'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'UNIQUE — referenced by circuits/logical_links' },
          provider: { type: 'string', description: 'e.g. AWS / Oracle / Equinix' },
          description: { type: 'string' },
          position: { $ref: '#/definitions/position' },
        },
      },
    },
    cables: {
      type: 'array',
      description: 'local physical connections (≈ NetBox Cable)',
      items: {
        type: 'object',
        required: ['a', 'b'],
        additionalProperties: false,
        properties: {
          a: { $ref: '#/definitions/endpoint' },
          b: { $ref: '#/definitions/endpoint' },
          type: { type: 'string', description: 'media, e.g. cat6 / smf / dac' },
          bandwidth: { type: 'string', description: 'e.g. 10Gbps, 2x10G LAG' },
          status: { type: 'string', description: 'e.g. connected / planned' },
          label: { type: 'string' },
        },
      },
    },
    circuits: {
      type: 'array',
      description: 'carrier circuits between sites or to provider networks (≈ NetBox Circuit)',
      items: {
        type: 'object',
        required: ['a', 'b'],
        additionalProperties: false,
        properties: {
          a: { $ref: '#/definitions/endpoint' },
          b: { $ref: '#/definitions/endpoint' },
          cid: { type: 'string', description: 'circuit ID' },
          provider: { type: 'string', description: 'carrier name' },
          type: { type: 'string', description: 'e.g. leased line / IP-VPN / Direct Connect' },
          commit_rate: { type: 'string', description: 'contracted bandwidth, e.g. 1Gbps' },
          status: { type: 'string' },
        },
      },
    },
    logical_links: {
      type: 'array',
      description:
        'logical (L3) adjacencies between routing instances (VRFs) — Network TopoDraft extension, not a NetBox object. Rendered in the logical view connecting VRF compartments.',
      items: {
        type: 'object',
        required: ['a', 'b'],
        additionalProperties: false,
        properties: {
          a: { $ref: '#/definitions/logical_endpoint' },
          b: { $ref: '#/definitions/logical_endpoint' },
          link_id: {
            type: 'string',
            description:
              'connection ID (VC / VIF / peering ID) — displayed as the link label on the diagram',
          },
          vlan: {
            type: 'string',
            description: 'VLAN ID used by this adjacency (e.g. the VIF VLAN)',
          },
          label: { type: 'string', description: "e.g. 'OSPF area 0', 'eBGP'" },
          description: { type: 'string' },
        },
      },
    },
  },
} as const;

const EXAMPLE = {
  version: 1,
  devices: [
    {
      name: 'rt-hq-01',
      role: 'router',
      site: 'HQ',
      tenant: 'NetOps',
      vrfs: ['PROD', 'DEV'],
      interfaces: [
        { name: 'Po1', type: 'lag', description: 'LAG to sw-hq-01' },
        { name: 'Gi0/0/1', lag: 'Po1' },
        { name: 'Gi0/0/2', lag: 'Po1' },
        { name: 'Gi0/0/3.100', ip_address: '10.10.100.1/30', type: 'virtual', vrf: 'PROD' },
      ],
      config_context: {
        bgp: { asn: 65010, neighbors: [{ peer: '169.254.10.2', remote_asn: 64512 }] },
      },
    },
    {
      name: 'rt-dc-01',
      role: 'router',
      site: 'DC',
      vrfs: ['PROD'],
      interfaces: [
        { name: 'Gi0/0/3.100', ip_address: '10.10.100.2/30', type: 'virtual', vrf: 'PROD' },
      ],
    },
    { name: 'sw-hq-01', role: 'switch', site: 'HQ' },
  ],
  provider_networks: [{ name: 'AWS Direct Connect', provider: 'AWS' }],
  cables: [
    {
      a: { device: 'rt-hq-01', interface: 'Po1' },
      b: { device: 'sw-hq-01' },
      bandwidth: '2x1G LAG',
      status: 'connected',
    },
  ],
  circuits: [
    {
      a: { site: 'HQ', device: 'rt-hq-01' },
      b: { provider_network: 'AWS Direct Connect' },
      cid: 'DX-001',
      provider: 'Equinix',
      type: 'Direct Connect',
      commit_rate: '1Gbps',
    },
  ],
  logical_links: [
    {
      a: { device: 'rt-hq-01', vrf: 'PROD', interface: 'Gi0/0/3.100' },
      b: { device: 'rt-dc-01', vrf: 'PROD', interface: 'Gi0/0/3.100' },
      label: 'eBGP',
      vlan: '100',
    },
    {
      a: { device: 'rt-hq-01', vrf: 'PROD' },
      b: { provider_network: 'AWS Direct Connect', id: 'dxcon-xyz789' },
      link_id: 'dxvif-abc123',
    },
  ],
};

/**
 * The "Schema" export: the import-format specification handed to an AI agent
 * so it can GENERATE a loadable topology (v7 `genSchema`, prose updated to
 * the extension reality — JSON only, the file itself is the import).
 */
export function genSchemaDoc(): string {
  return `# Network TopoDraft import schema (for AI agents & external tools)

Generate a JSON document that follows the schema below and save it as a \`*.topo.json\` file — Network TopoDraft opens it directly in the editor. The idea: draft the topology externally (e.g. with an AI agent), then fine-tune it in the editor.

## Rules
- JSON only. Set "version": 1 (required). "$schema" pointing at the published topodraft.schema.json is optional but recommended.
- Only the "devices" array is required (it may even be empty). Every other field is optional — omit fields instead of writing "" or null.
- "name" values of devices and provider_networks must be UNIQUE; cables / circuits / logical_links reference them by name.
- "position" is optional. If omitted, the editor auto-arranges nodes by site on open.
- role / site / tenant / vrf / status / type are FREE TEXT (no fixed enum). Field naming follows NetBox conventions.
- Subinterfaces use dotted names (Gi0/0/1.100). LAG membership: set "lag" on member interfaces to the parent interface name (e.g. Po1); give the parent interface type "lag".
- VRF model: devices declare routing instances in "vrfs"; logical_links connect a {device, vrf} pair to another {device, vrf} pair. Omitting "vrf" on an endpoint means the global routing table. Endpoints on the two sides may have different VRFs (e.g. route leaking).
- When a peer's VRF name is unknown (external tenants, provider attachments), put the known identifier in the endpoint "id" (tenant ID, VIF/VC ID). A per-connection identifier belongs in "link_id" and is displayed on the diagram.
- "config_context" on a device may hold any JSON object with device settings (routing, BGP, policies …); the editor stores it and re-exports it unchanged.
- Circuits and logical_links may terminate on a provider network via {"provider_network": "<name>"}.

## JSON Schema (draft-07)
\`\`\`json
${JSON.stringify(topoJsonSchema, null, 2)}
\`\`\`

## Minimal valid example
\`\`\`json
${JSON.stringify(EXAMPLE, null, 2)}
\`\`\``;
}
