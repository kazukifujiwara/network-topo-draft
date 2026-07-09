# topodraft-mcp

MCP ([Model Context Protocol](https://modelcontextprotocol.io)) server for
[TopoDraft](https://github.com/kazukifujiwara/network-topo-draft) network
topology files (`*.topo.json` / `*.topo`): AI agents learn the file format,
read topologies, and validate their edits through three read-only tools —
the same validation loop the VSCode extension runs in its Problems panel.

| Tool | What it does |
| --- | --- |
| `describe_format` | The format contract: editing rules, published JSON Schema, minimal example |
| `read_topology` | Summary (devices/links/sites/VRFs, diagnostic counts) + canonical topology JSON |
| `validate_topology` | Editor-grade diagnostics: JSON syntax, topology shape, semantic rules, unknown-field did-you-mean |
| `render_svg` | The diagram as a standalone SVG (physical or logical view) — agents can *see* what they drew |
| `add_device` / `update_device` / `remove_device` | Structured device edits — renames follow every link reference |
| `add_link` / `remove_link` | Cables, carrier circuits, and logical links; endpoints are checked against existing nodes |
| `set_position` | Move nodes on the canvas (pairs with `render_svg` for layout passes) |

Every edit rewrites the file in TopoDraft's canonical form (clean diffs)
and returns the post-edit diagnostics, so mistakes surface immediately.
Start the server with `--read-only` to disable the edit tools entirely —
they are not even listed.

Local file access only. No network, no telemetry, zero runtime dependencies
(one self-contained bundle).

## Setup

Claude Code:

```sh
claude mcp add topodraft -- npx -y topodraft-mcp
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "topodraft": {
      "command": "npx",
      "args": ["-y", "topodraft-mcp"]
    }
  }
}
```

Any other MCP client: run `topodraft-mcp` as a stdio server.

## Typical agent flow

1. `describe_format` — once, before the first edit
2. Edit the `*.topo.json` file as text (the TopoDraft canvas follows live)
3. `validate_topology` — after every edit; fix what it reports
4. `render_svg` — look at the result; adjust `position` values if the layout overlaps

See the [TopoDraft repository](https://github.com/kazukifujiwara/network-topo-draft)
for the VSCode extension, the file-format specification, and the
`topodraft-cli` command-line validator.
