# topodraft-cli

Validate [TopoDraft](https://github.com/kazukifujiwara/network-topo-draft)
network-topology files (`*.topo.json` / `*.topo`) from the command line —
the exact same diagnostics as the TopoDraft VSCode extension's Problems
panel, for CI pipelines and AI agents running outside the editor.

```sh
topodraft validate network/*.topo.json
```

```
network/dc-east.topo.json:14:22 error dangling-reference Endpoint references device "ghost", …
network/dc-east.topo.json:9:31 warning unknown-field Unknown field "ip" — did you mean "ip_address"? …
```

- Checks JSON syntax, topology shape, semantic rules (dangling references,
  duplicate names, LAG parents, IPs outside a segment prefix, …), and
  unknown fields with did-you-mean suggestions — each with `file:line:col`.
- `--json` for machine-readable output, `--strict` to fail on warnings.
- Exit codes: `0` clean, `1` findings failed the gate, `2` usage/IO error.
- Single self-contained bundle; no runtime dependencies installed.

The file format is documented in the
[format specification](https://github.com/kazukifujiwara/network-topo-draft/blob/main/docs/topodraft-file-format-v1.md);
the editor lives in the TopoDraft VSCode extension.

Apache License 2.0.
