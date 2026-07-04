# Network Configuration

Generated: 2026-07-04 · 4 devices · 5 links · 2 sites

## Devices

| name | role | site | tenant | vrfs | device_type | platform |
| --- | --- | --- | --- | --- | --- | --- |
| rt-hq-01 | router | HQ | — | PROD | — | — |
| fw-hq-01 | firewall | HQ | — | — | — | — |
| sw-hq-01 | switch | HQ | — | — | — | — |
| aws-tgw | aws external_peer | AWS | — | — | — | — |

## Provider Networks

| name | provider | description |
| --- | --- | --- |
| AWS Direct Connect | AWS | DX location: Equinix TY2 |

## Interfaces

| device | interface | ip_address | vrf | lag | type | description |
| --- | --- | --- | --- | --- | --- | --- |
| rt-hq-01 | Gi0/0/0 | — | — | — | — | to DX |
| rt-hq-01 | Gi0/0/0.100 | 169.254.10.1/30 | PROD | — | virtual | DX VIF |

## Local Connections (Cables)

| A | B | type | bandwidth | status | label |
| --- | --- | --- | --- | --- | --- |
| rt-hq-01 | fw-hq-01 | cat6 | — | connected | — |
| fw-hq-01 | sw-hq-01 | cat6 | — | connected | — |

## Carrier Circuits

| cid | provider | type | commit_rate | status | A | B |
| --- | --- | --- | --- | --- | --- | --- |
| DX-CID-01 | Equinix | Direct Connect | 1Gbps | active | HQ / rt-hq-01 / Gi0/0/0 | PN: AWS Direct Connect |
| — | — | hosted connection | — | active | PN: AWS Direct Connect | AWS / aws-tgw |

## Logical Links (L3 / VRF)

| link_id | vlan | A (device [vrf] if) | B (device [vrf] if) | label | description |
| --- | --- | --- | --- | --- | --- |
| dxvif-abc123 | 100 | rt-hq-01 / [PROD] / Gi0/0/0.100 | aws-tgw / id:tgw-attach-01 | eBGP over DX VIF | — |

## Config Contexts

### rt-hq-01

```json
{
  "bgp": {
    "asn": 65010,
    "neighbors": [
      {
        "peer": "169.254.10.2",
        "remote_asn": 64512
      }
    ]
  }
}
```

