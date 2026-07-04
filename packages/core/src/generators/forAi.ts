/**
 * "For AI" export (ported from v7 `genAI` / `schemaLegend`): a schema legend
 * plus the current data, meant to be pasted into an AI chat to describe THIS
 * topology.
 *
 * Deviation from v7 (approved): the embedded JSON is the canonical v1
 * serialization (includes `version`, spec key order) instead of the legacy
 * v7 export shape.
 */

import type { Topology } from '../model';
import { serialize } from '../serialize';

export function schemaLegend(): string {
  return `- devices[] : network devices (≈ NetBox Device)
  - name: hostname (unique, used as reference key) / device_type / role: free text / site: location grouping / tenant: owning organization / platform: OS
  - vrfs[]: VRF routing instances configured on the device (names, free text)
  - config_context: free-form structured settings per device (routing, BGP, policies …) as a JSON object; stored as-is, not drawn
  - interfaces[]: name (physical "Gi0/0/1", subinterface "Gi0/0/1.100", or LAG parent "Po1"), ip_address (CIDR), type, description, lag (parent LAG interface on the same device), vrf (VRF the interface belongs to)
  - position: editor canvas coordinates {x,y} — no network meaning; optional
- provider_networks[] : carrier-side networks such as AWS Direct Connect / OCI FastConnect (≈ NetBox Provider Network)
  - name (unique) / provider / description / position
- cables[] : local physical connections (≈ NetBox Cable) — a/b: {device, interface}; type / bandwidth / status / label
- circuits[] : carrier circuits (≈ NetBox Circuit) — cid / provider / type / commit_rate / status; a/b: {site, device, interface} or {provider_network}
- networks[] : multi-access L3 segments (TopoDraft extension; ≈ NetBox Prefix + FHRPGroup) — name (unique) / prefix (CIDR) / vlan / fhrp {protocol, group, virtual_ip} / description / position. Devices attach via logical_links whose far endpoint is {network}
- logical_links[] : logical (L3) adjacencies between routing instances — TopoDraft extension, not a NetBox object
  - a / b endpoints: {device, vrf, id, interface, ip_address} — vrf omitted = global routing table; id = environment/attachment identifier (tenant ID, VIF/VC ID) for peers whose VRF name is unknown; ip_address allowed directly when no interface is named; {provider_network, id} and {network} are also accepted
  - link_id (connection / VC / VIF ID — displayed on the diagram) / vlan (VLAN ID) / label / description
- Empty fields are omitted. Devices sharing the same "site" belong to the same location.`;
}

export function genForAi(topology: Topology): string {
  return `The following is network topology data. Read "Topology data (JSON)" using the schema legend below.

## Schema legend
${schemaLegend()}

## Topology data (JSON)
\`\`\`json
${serialize(topology)}\`\`\``;
}
