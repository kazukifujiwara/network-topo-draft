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

## Interactive canvas (MCP Apps)

On hosts that support [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview)
(Claude, Claude Desktop, and other clients that declare the
`io.modelcontextprotocol/ui` capability), `render_svg` renders an
**interactive TopoDraft canvas inline** in the conversation — pan/zoom,
physical ⇄ logical view toggles, VRF compartments — instead of a static
image. The widget is the same renderer the VSCode extension uses,
shipped as one self-contained document (nothing is loaded remotely).

- Read-only in this phase: the canvas is for exploring the render;
  edits still go through the edit tools (or the file itself).
- On every other host the tool returns the standalone SVG text,
  byte-identical to previous releases — no configuration needed either way.

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
2. Make the change — pick the right write path:
   - **Bulk authoring** (a new file, a large rework): write the JSON file
     directly; it is the fastest path and the canvas follows live
   - **Small changes**: use the edit tools — each response already carries
     the post-edit diagnostics, and renames follow every link reference
3. `validate_topology` — after every change, whatever the write path
4. `render_svg` — look at the result; adjust positions (`set_position`)
   if the layout overlaps

See the [TopoDraft repository](https://github.com/kazukifujiwara/network-topo-draft)
for the VSCode extension, the file-format specification, and the
`topodraft-cli` command-line validator.
