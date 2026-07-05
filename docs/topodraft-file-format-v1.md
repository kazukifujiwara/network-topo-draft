# TopoDraft File Format Specification v1 (`*.topo.json`)

- Status: Draft v1.0 (2026-07)
- Role: the canonical file format of the TopoDraft VSCode extension. **This document and the JSON Schema (`schema/topodraft.schema.json`) are the contract for AI agents (GitHub Copilot / Claude Code / NetBox-MCP-driven agents, etc.) that read and write these files directly** — and the only normative specification
- Related: `topodraft-vscode-plan.md` (development plan / ADRs)

---

## 1. Basic Principles

1. **JSON only.** YAML is not supported (ADR D2)
2. File names match `*.topo.json` (canonical; e.g. `dallas-dc.topo.json`) or the alias `*.topo`. VSCode associates both patterns with the TopoDraft editor and schema validation. Prefer `.topo.json` — every tool recognizes it as JSON; `.topo` survives finder copies / save-dialog stem edits better
3. Field names **follow NetBox naming**. Elements with no NetBox counterpart are explicitly marked as "TopoDraft extensions" in §8
4. **Every field except `devices` is optional.** Do not write empty strings / arrays / objects — omit the field entirely (exception: the contents of `config_context` are preserved verbatim)
5. `position` is editor metadata with no network meaning. When omitted, nodes are auto-arranged on open
6. Device names and provider-network names are **unique within a file**. Links reference them by name (there are no stable IDs)

## 2. Top-level Structure

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/<repo>/main/schema/topodraft.schema.json",  // optional, recommended
  "version": 1,                    // required (fixed to 1 in v1). If missing, the file is read as legacy (§7)
  "devices": [ ... ],              // required (may be empty)
  "provider_networks": [ ... ],    // optional
  "networks": [ ... ],             // optional (TopoDraft extension, §3.10)
  "cables": [ ... ],               // optional
  "circuits": [ ... ],             // optional
  "logical_links": [ ... ]         // optional (TopoDraft extension)
}
```

## 3. Object Definitions

### 3.1 devices[] — network devices (≈ NetBox Device)

| Field | Type | Description |
| --- | --- | --- |
| `name` | string **required** | Hostname. Unique. The reference key used by links |
| `device_type` | string | Vendor + model (e.g. `"Cisco C8300"`) |
| `role` | string | Free text (router / switch / firewall / external_peer, …). Used to infer the drawn icon |
| `site` | string | Location. Devices sharing a value are framed together; cross-site links default to circuit |
| `tenant` | string | Owning organization |
| `platform` | string | OS (e.g. `"IOS-XE 17.12"`) |
| `vrfs` | string[] | VRF (routing instance) names defined on the device. Drawn as compartments in the logical view |
| `interfaces` | object[] | §3.2 |
| `config_context` | object | Free-form structured settings for the device (§3.3; TopoDraft-extension semantics, see §8) |
| `position` | `{x:number, y:number}` | Canvas coordinates. Optional |

### 3.2 interfaces[] (under devices)

| Field | Type | Description |
| --- | --- | --- |
| `name` | string | Physical `Gi0/0/1`, subinterface `Gi0/0/1.100` (dot notation), LAG parent `Po1` |
| `ip_address` | string | CIDR notation (e.g. `"10.0.0.1/30"`) |
| `type` | string | e.g. `1000base-t` / `lag` / `virtual` |
| `description` | string | Free text |
| `lag` | string | Name of the parent LAG interface **on the same device** (e.g. `"Po1"`). The parent interface itself uses `type: "lag"` |
| `vrf` | string | The VRF this interface belongs to |

### 3.3 config_context (under devices, optional)

- Any JSON whose **top level is an object** (arrays and scalars are rejected)
- Holds free-form structured data such as routing settings, BGP, policies. **It never affects rendering**
- The editor does not interpret the contents; it **preserves and re-emits them verbatim** (values such as empty strings are NOT omitted)

```jsonc
"config_context": {
  "bgp": { "asn": 65010, "neighbors": [{ "peer": "169.254.10.2", "remote_asn": 64512 }] }
}
```

### 3.4 provider_networks[] — carrier-side networks (≈ NetBox Provider Network)

AWS Direct Connect / OCI FastConnect / IP-VPN clouds, etc.

| Field | Type | Description |
| --- | --- | --- |
| `name` | string **required** | Unique. Referenced by circuits / logical_links |
| `provider` | string | e.g. `"AWS"` / `"Oracle"` / `"Equinix"` |
| `description` | string | Free text |
| `position` | object | Coordinates (optional) |

Links attached to a provider network are always **circuits** (never cables).

### 3.5 cables[] — local physical connections (≈ NetBox Cable)

| Field | Type | Description |
| --- | --- | --- |
| `a`, `b` | endpoint **required** | `{device, interface}` (§3.8-A) |
| `type` | string | Media (cat6 / smf / dac, …) |
| `bandwidth` | string | e.g. `"10Gbps"` / `"2x10G LAG"` |
| `status` | string | connected / planned, … (free text) |
| `label` | string | Free label |

### 3.6 circuits[] — carrier circuits (≈ NetBox Circuit)

| Field | Type | Description |
| --- | --- | --- |
| `a`, `b` | endpoint **required** | `{site?, device, interface?}` or `{provider_network}` (§3.8-A) |
| `cid` | string | Circuit ID |
| `provider` | string | Carrier name |
| `type` | string | Leased line / IP-VPN / Direct Connect, … |
| `commit_rate` | string | Contracted bandwidth (e.g. `"1Gbps"`) |
| `status` | string | active / provisioning, … |

### 3.7 logical_links[] — logical (L3) adjacencies [TopoDraft extension]

Logical connections between routing instances (VRFs). NetBox has no corresponding object (§8).

| Field | Type | Description |
| --- | --- | --- |
| `a`, `b` | logical endpoint **required** | §3.8-B |
| `link_id` | string | Connection ID (VC / VIF / peering ID). **Displayed as the link's label on the canvas** |
| `vlan` | string | VLAN ID used by this adjacency (e.g. the VIF VLAN) |
| `label` | string | e.g. `"eBGP"` / `"OSPF area 0"` |
| `description` | string | Free text |

### 3.8 Endpoint definitions

**A. Physical endpoints (cables / circuits)** — one of the two shapes:

```jsonc
{ "site": "HQ", "device": "rt-hq-01", "interface": "Gi0/0/0" }   // site/interface optional
{ "provider_network": "AWS Direct Connect" }
```

**B. Logical endpoints (logical_links)** — one of the three shapes:

```jsonc
{ "device": "rt-hq-01", "vrf": "PROD", "id": "tenant-abc", "interface": "Gi0/0/0.100", "ip_address": "169.254.10.1/30" }
{ "provider_network": "AWS Direct Connect", "id": "dxcon-xyz789" }
{ "network": "svc-seg-01" }                                          // attaches to a networks[] segment (§3.10)
```

| Field | Description |
| --- | --- |
| `vrf` | A routing instance on that device. **Omitted/empty = the global routing table.** The two ends may hold different VRFs (route-leak representation) |
| `id` | Environment/attachment identifier for peers whose VRF name is unknown (tenant ID, VIF/VC ID, …). Drawn next to that end of the link |
| `interface` | The interface used (typically a subinterface) |
| `ip_address` | An endpoint may carry an IP directly **only when `interface` is not specified**. With an `interface`, put the IP on that device's `interfaces[]` instead (on load, the editor normalizes an `interface` + `ip_address` pair by writing the IP onto the device-side interface) |

### 3.9 VRF derivation rule (important)

A device's logical-view compartments are derived as the **union** of:

```
explicit devices[].vrfs  ∪  interfaces[].vrf  ∪  endpoint.vrf of logical_links terminating on that device
```

Therefore an agent that writes a vrf on a logical-link endpoint is not strictly required to also add it to `vrfs[]` (explicit declaration is nonetheless recommended; Diagnostics warns about "undeclared VRFs").

### 3.10 networks[] — multi-access L3 segments [TopoDraft extension]

A subnet shared by multiple devices (server segments, HSRP/VRRP gateway pairs, DMZs). NetBox's closest counterparts are Prefix and FHRPGroup (§8). Drawn **only in the logical view** as a segment node; the physical realization (switches, cables, VLANs) stays in the physical layer.

| Field | Type | Description |
| --- | --- | --- |
| `name` | string **required** | Unique (shared namespace with devices / provider networks). Referenced by logical endpoints |
| `prefix` | string | Subnet in CIDR (e.g. `"10.0.0.0/28"`) |
| `vlan` | string | VLAN ID of the segment |
| `fhrp` | object | First-hop redundancy: `protocol` (hsrp / vrrp / glbp …, free text; NetBox uses the slugs `hsrp` / `vrrp2` / `vrrp3` / `glbp` / `carp`), `group_id` (NetBox FHRPGroup.group_id), `virtual_ip` (CIDR) |
| `description` | string | Free text |
| `position` | object | Coordinates (optional) |

**Attachment convention**: each attached device gets **one logical link** whose far endpoint is `{ "network": "<name>" }`. The device-side endpoint carries `vrf` / `interface` as usual; real IPs live on `devices[].interfaces[].ip_address`, while the shared virtual IP lives on the segment's `fhrp.virtual_ip`. Diagnostics warn when an attached IP or the virtual IP falls outside `prefix`.

```jsonc
"networks": [
  { "name": "svc-seg", "prefix": "10.0.0.0/28", "vlan": "100",
    "fhrp": { "protocol": "hsrp", "group_id": "1", "virtual_ip": "10.0.0.1/28" } }
],
"logical_links": [
  { "a": { "device": "rt-01", "vrf": "PROD", "interface": "Gi0/1.100" }, "b": { "network": "svc-seg" } },
  { "a": { "device": "rt-02", "vrf": "PROD", "interface": "Gi0/1.100" }, "b": { "network": "svc-seg" } }
]
```

## 4. Canonical Serialization Rules (guaranteed editor output)

For stable git diffs and stable diff-based agent editing, the editor's save output follows the rules below. **Agents are encouraged to follow them too** when writing files (non-conforming files still load; the editor normalizes them on the next save).

1. 2-space indentation, LF line endings, exactly one trailing newline
2. Top-level key order: `$schema` → `version` → `devices` → `provider_networks` → `networks` → `cables` → `circuits` → `logical_links`
3. Keys inside each object follow the order of the tables in §3. `position` always comes **last** in its object
4. Array order **preserves** the user's/agent's writing order — never re-sorted
5. Empty fields (empty string / array / object) are not emitted (except inside `config_context`)
6. Output from an identical model is byte-identical (deterministic). `serialize(parse(text))` is idempotent

## 5. Two-layer Validation

| Layer | Owner | Contents |
| --- | --- | --- |
| Structural | JSON Schema (applied to `*.topo.json` at all times via `jsonValidation`) | Types, required fields, allowed fields (additionalProperties: false). Agents editing the file as text get completion and instant errors |
| Semantic | Diagnostics (the extension's validate) | Duplicate names (E) / dangling references (E) / missing LAG parent (W) / reference to a nonexistent interface (W) / undeclared VRF (W) / missing version (I), etc. Feeds the agents' self-correction loop via the Problems panel |

## 6. Complete Example

```json
{
  "version": 1,
  "devices": [
    {
      "name": "rt-hq-01",
      "device_type": "Cisco C8300",
      "role": "router",
      "site": "HQ",
      "tenant": "NetOps",
      "vrfs": ["PROD"],
      "interfaces": [
        { "name": "Po1", "type": "lag", "description": "LAG to sw-hq-01" },
        { "name": "Gi0/0/1", "lag": "Po1" },
        { "name": "Gi0/0/2", "lag": "Po1" },
        { "name": "Gi0/0/0.100", "ip_address": "169.254.10.1/30", "type": "virtual", "description": "DX VIF", "vrf": "PROD" }
      ],
      "config_context": {
        "bgp": { "asn": 65010, "neighbors": [{ "peer": "169.254.10.2", "remote_asn": 64512 }] }
      },
      "position": { "x": 120, "y": 60 }
    },
    { "name": "sw-hq-01", "role": "switch", "site": "HQ", "position": { "x": 120, "y": 210 } },
    { "name": "aws-tgw", "role": "external_peer", "site": "AWS", "position": { "x": 820, "y": 60 } }
  ],
  "provider_networks": [
    { "name": "AWS Direct Connect", "provider": "AWS", "position": { "x": 470, "y": 60 } }
  ],
  "cables": [
    { "a": { "device": "rt-hq-01", "interface": "Po1" }, "b": { "device": "sw-hq-01" }, "bandwidth": "2x1G LAG", "status": "connected" }
  ],
  "circuits": [
    {
      "a": { "site": "HQ", "device": "rt-hq-01", "interface": "Gi0/0/0" },
      "b": { "provider_network": "AWS Direct Connect" },
      "cid": "DX-CID-01", "provider": "Equinix", "type": "Direct Connect", "commit_rate": "1Gbps", "status": "active"
    }
  ],
  "logical_links": [
    {
      "a": { "device": "rt-hq-01", "vrf": "PROD", "interface": "Gi0/0/0.100" },
      "b": { "device": "aws-tgw", "id": "tgw-attach-01" },
      "link_id": "dxvif-abc123",
      "vlan": "100",
      "label": "eBGP over DX VIF"
    }
  ]
}
```

## 7. Legacy Compatibility (on load)

The extension **absorbs the following at load time** and normalizes to v1 canonical form on the next save (compatibility is guaranteed by golden-file tests):

| Input | Handling |
| --- | --- |
| Missing `version` (standalone HTML v4–v7 exports) | Interpreted as v1; `version: 1` is added on save |
| Top-level `vrf` on a logical link (v3 format) | Expanded onto both endpoints' `vrf` |
| Logical endpoint with both `interface` and `ip_address` | The IP is written onto the device-side `interfaces[]` (if no existing value) |
| `fhrp.group` (pre-rename, before 2026-07-06) | Read as `fhrp.group_id` (`group_id` wins if both are present) |
| Unknown fields | A schema error (additionalProperties: false). parse loads what it can; Diagnostics warns — including a note that **unknown fields will be lost on save** |

## 8. NetBox Mapping Notes (for agents)

The editor performs no NetBox sync (ADR D5). Notes for agents bridging this file and NetBox via NetBox MCP / API:

| This format | NetBox | Caveats |
| --- | --- | --- |
| `devices[].name/site/role/device_type/platform/tenant` | Device plus FK objects | In this format these are **all free-text strings**. In NetBox they are FKs to Site / DeviceRole / DeviceType (requires Manufacturer) / Platform / Tenant. A push needs name resolution and a create-if-missing policy |
| `devices[].vrfs` / `interfaces[].vrf` | VRF (requires RD etc.) / Interface.vrf | VRFs are name-only here; no RD |
| `interfaces[].lag` | Interface.lag (self-referential FK) | Same naming convention |
| `interfaces[].ip_address` | IPAddress (separate object) + assigned interface | Flattened here as an interface attribute |
| `devices[].config_context` | **`local_context_data`** (the writable field). NetBox's `config_context` is computed and read-only | **Write to `local_context_data` when pushing.** The name here is unified as `config_context` for TopoDraft's convenience |
| `provider_networks[]` | circuits.ProviderNetwork (requires Provider FK) | — |
| `circuits[]` | Circuit + CircuitTermination | `commit_rate` in NetBox is an integer in kbps; here it is a free string such as `"1Gbps"` |
| `networks[]` | **Prefix + FHRPGroup (TopoDraft extension)** | `prefix`/`vlan` map to Prefix (+VLAN); `fhrp.protocol/group_id` map by name to FHRPGroup (NetBox protocol slugs: `hsrp`/`vrrp2`/`vrrp3`/…; `group_id` is an integer there), `virtual_ip` flattens FHRPGroup's assigned `ip_addresses`; attachments correspond to IPAddress assignments |
| `logical_links[]` | **No corresponding object (TopoDraft extension)** | When pushing, either design a representation on the agent side (tags / custom fields / L2VPN, …) or exclude them |
| `position` | None | Never send to NetBox |

## 9. Versioning Policy

- Increment `version` **only for breaking changes** (field removal or meaning change); implement a read migration for the old version in `parse.ts` and add the corresponding golden fixture
- Backward-compatible additions (new optional fields) may stay at `version: 1` with a schema extension (record the revision date in the schema file)
  - 2026-07-05: `networks[]` (multi-access L3 segments with FHRP, §3.10) and the `{network}` logical endpoint shape added; `version` stays 1
  - 2026-07-06: `fhrp.group` renamed to `group_id` (NetBox FHRPGroup naming); the old key is absorbed on load (§7); `version` stays 1. File-name alias `*.topo` accepted alongside `*.topo.json` (§1)
- The schema, this document, and fixtures must be updated **in the same PR** (plan §6.4 Definition of Done)
