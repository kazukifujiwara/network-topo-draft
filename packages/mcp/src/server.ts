/**
 * MCP server assembly (#11/#12): registers the TopoDraft tools on an
 * McpServer. File access is injected so tests can drive the full client ⇄
 * server loop over an in-memory transport without touching the disk; only
 * mcp.ts binds the real file system and the stdio transport.
 *
 * Local file access only, no network, no telemetry. Edit tools (#12) go
 * parse → mutate → deterministic serialize with the post-edit diagnostics
 * in every response; `--read-only` disables them entirely (they are not
 * even listed).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  RESOURCE_MIME_TYPE,
  getUiCapability,
  registerAppResource,
  registerAppTool,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { TopoParseError } from '@topodraft/core';
import {
  TOOL_DOCS,
  TOPO_FILE_RE,
  addDeviceText,
  addLinkText,
  describeFormat,
  readTopologyText,
  removeDeviceText,
  removeLinkText,
  renderStructured,
  setPositionText,
  updateDeviceText,
  validateTopologyText,
} from './tools';
import type { EditOutcome } from './tools';

export interface ServerIo {
  /** Read a file as UTF-8; throw on failure. */
  readFile(path: string): string;
  /** Write a file as UTF-8; throw on failure. Unused with --read-only. */
  writeFile(path: string, text: string): void;
}

export interface ServerOptions {
  /** Register only the read/render tools (edit tools are not listed). */
  readOnly?: boolean;
  /**
   * The self-contained widget document (packages/app-view dist/app.html).
   * When present, render_svg declares it as an MCP Apps UI resource
   * (#30) and delivers the topology via structuredContent; without it the
   * server behaves exactly like v0.5.0 (plain SVG text only).
   */
  appHtml?: string;
}

/** ui:// address of the interactive canvas (the tool's _meta.ui.resourceUri). */
export const CANVAS_RESOURCE_URI = 'ui://topodraft/canvas.html';

const text = (s: string): CallToolResult => ({ content: [{ type: 'text', text: s }] });
const errorText = (s: string): CallToolResult => ({
  content: [{ type: 'text', text: s }],
  isError: true,
});

export function createServer(io: ServerIo, version: string, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'topodraft', version });

  const readTopoFile = (path: string): string => {
    if (!TOPO_FILE_RE.test(path)) {
      throw new Error(`not a topology file (expected *.topo.json or *.topo): ${path}`);
    }
    return io.readFile(path);
  };

  /** Edit-tool wrapper: read → pure edit → write back → report + diagnostics. */
  const applyEdit = (path: string, edit: (text: string) => EditOutcome): CallToolResult => {
    try {
      const outcome = edit(readTopoFile(path));
      io.writeFile(path, outcome.text);
      return text(
        JSON.stringify(
          {
            file: path,
            applied: outcome.applied,
            ok: outcome.diagnostics.every((d) => d.severity !== 'error'),
            diagnostics: outcome.diagnostics,
          },
          null,
          2,
        ),
      );
    } catch (e) {
      if (e instanceof TopoParseError) {
        return errorText(
          `${path}: the document does not parse (${e.message}) — run validate_topology for line-level diagnostics`,
        );
      }
      return errorText(`${path}: ${(e as Error).message}`);
    }
  };

  server.registerTool('describe_format', TOOL_DOCS.describe_format, () =>
    text(describeFormat()),
  );

  server.registerTool(
    'read_topology',
    {
      title: TOOL_DOCS.read_topology.title,
      description: TOOL_DOCS.read_topology.description,
      inputSchema: { path: z.string().describe(TOOL_DOCS.read_topology.pathDescription) },
    },
    ({ path }) => {
      try {
        return text(JSON.stringify({ file: path, ...readTopologyText(readTopoFile(path)) }, null, 2));
      } catch (e) {
        if (e instanceof TopoParseError) {
          return errorText(
            `${path}: the document does not parse (${e.message}) — run validate_topology for line-level diagnostics`,
          );
        }
        return errorText(`${path}: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'validate_topology',
    {
      title: TOOL_DOCS.validate_topology.title,
      description: TOOL_DOCS.validate_topology.description,
      inputSchema: { path: z.string().describe(TOOL_DOCS.validate_topology.pathDescription) },
    },
    ({ path }) => {
      try {
        return text(JSON.stringify({ file: path, ...validateTopologyText(readTopoFile(path)) }, null, 2));
      } catch (e) {
        return errorText(`${path}: ${(e as Error).message}`);
      }
    },
  );

  /* render_svg — one tool for both worlds (#30 decision): MCP Apps hosts
     get the interactive canvas via _meta.ui + structuredContent, everyone
     else keeps the plain SVG text that has been the contract since v0.5.0. */
  const renderConfig = {
    title: TOOL_DOCS.render_svg.title,
    description: TOOL_DOCS.render_svg.description,
    inputSchema: {
      path: z.string().describe(TOOL_DOCS.render_svg.pathDescription),
      view: z
        .enum(['physical', 'logical'])
        .optional()
        .describe(TOOL_DOCS.render_svg.viewDescription),
      show_global: z.boolean().optional().describe(TOOL_DOCS.render_svg.showGlobalDescription),
      underlay: z.boolean().optional().describe(TOOL_DOCS.render_svg.underlayDescription),
      background: z
        .enum(['canvas', 'transparent'])
        .optional()
        .describe(TOOL_DOCS.render_svg.backgroundDescription),
    },
  };
  type RenderArgs = {
    path: string;
    view?: 'physical' | 'logical';
    show_global?: boolean;
    underlay?: boolean;
    background?: 'canvas' | 'transparent';
  };
  /**
   * Apps enrichment is gated PER CLIENT (#31): the host must have declared
   * capabilities.extensions["io.modelcontextprotocol/ui"] at initialize.
   * Non-capable hosts get results byte-identical to v0.5.0. (The tools/list
   * `_meta.ui` and the ui:// resource stay statically registered — metadata
   * is ignored by hosts that do not know the extension, which is exactly
   * the forward-compatibility the spec designs for.)
   */
  const clientSupportsApps = (): boolean =>
    getUiCapability(server.server.getClientCapabilities()) !== undefined;

  const renderHandler =
    (withWidget: boolean) =>
    ({ path, view, show_global, underlay, background }: RenderArgs): CallToolResult => {
      try {
        const rendered = renderStructured(readTopoFile(path), {
          view,
          showGlobal: show_global,
          underlay,
          background,
        });
        const result = text(rendered.svg);
        if (withWidget && clientSupportsApps()) {
          // the widget's contract (app-view bridge.ts RenderPayload):
          // canonical topology + the view toggles this render was asked for
          result.structuredContent = {
            topology: rendered.topology as unknown as Record<string, unknown>,
            view: view ?? 'physical',
            show_global: show_global !== false,
            underlay: underlay !== false,
          };
        }
        return result;
      } catch (e) {
        if (e instanceof TopoParseError) {
          return errorText(
            `${path}: the document does not parse (${e.message}) — run validate_topology for line-level diagnostics`,
          );
        }
        return errorText(`${path}: ${(e as Error).message}`);
      }
    };

  if (options.appHtml === undefined) {
    server.registerTool('render_svg', renderConfig, renderHandler(false));
  } else {
    const appHtml = options.appHtml;
    registerAppTool(server, 'render_svg', {
      ...renderConfig,
      _meta: { ui: { resourceUri: CANVAS_RESOURCE_URI } },
    }, renderHandler(true));
    registerAppResource(
      server,
      'TopoDraft Canvas',
      CANVAS_RESOURCE_URI,
      {
        description:
          'Interactive TopoDraft canvas rendered inline by MCP Apps hosts: pan/zoom, ' +
          'physical and logical views. Read-only; fully self-contained (no remote loads).',
        _meta: { ui: { prefersBorder: true } },
      },
      (uri) => ({
        contents: [{ uri: uri.toString(), mimeType: RESOURCE_MIME_TYPE, text: appHtml }],
      }),
    );
  }

  if (options.readOnly) return server;

  /* ---------- edit tools (#12) ---------- */

  const pathArg = z.string().describe('Path to the topology file (*.topo.json or *.topo)');
  const endpointArg = (side: string): z.ZodTypeAny =>
    z
      .object({})
      .passthrough()
      .describe(
        `Endpoint ${side}: an object like {"device":"rt-01","interface":"Gi0/0/0"} — ` +
          'device / provider_network / network plus optional fields (see describe_format)',
      );
  const deviceFieldArgs = {
    role: z.string().optional().describe('Device role (router, switch, …); "" removes it'),
    site: z.string().optional().describe('Site name; "" removes it'),
    device_type: z.string().optional().describe('Hardware model label; "" removes it'),
    interfaces: z
      .array(z.object({}).passthrough())
      .optional()
      .describe('Full replacement of the interfaces array; [] removes it (see describe_format)'),
  };

  server.registerTool(
    'add_device',
    {
      title: TOOL_DOCS.add_device.title,
      description: TOOL_DOCS.add_device.description,
      inputSchema: {
        path: pathArg,
        name: z.string().optional().describe('Device name (auto-generated from role when omitted)'),
        x: z.number().optional().describe('Canvas x (default: right of the current diagram)'),
        y: z.number().optional().describe('Canvas y (default: 60)'),
        ...deviceFieldArgs,
      },
    },
    ({ path, ...params }) => applyEdit(path, (t) => addDeviceText(t, params)),
  );

  server.registerTool(
    'update_device',
    {
      title: TOOL_DOCS.update_device.title,
      description: TOOL_DOCS.update_device.description,
      inputSchema: {
        path: pathArg,
        name: z.string().describe('Current device name'),
        new_name: z.string().optional().describe('New name (link references are followed)'),
        ...deviceFieldArgs,
      },
    },
    ({ path, ...params }) => applyEdit(path, (t) => updateDeviceText(t, params)),
  );

  server.registerTool(
    'remove_device',
    {
      title: TOOL_DOCS.remove_device.title,
      description: TOOL_DOCS.remove_device.description,
      inputSchema: { path: pathArg, name: z.string().describe('Device name') },
    },
    ({ path, name }) => applyEdit(path, (t) => removeDeviceText(t, name)),
  );

  server.registerTool(
    'add_link',
    {
      title: TOOL_DOCS.add_link.title,
      description: TOOL_DOCS.add_link.description,
      inputSchema: {
        path: pathArg,
        kind: z.enum(['cable', 'circuit', 'logical']).describe('Link kind'),
        a: endpointArg('a'),
        b: endpointArg('b'),
        attributes: z
          .object({})
          .passthrough()
          .optional()
          .describe('Extra top-level link fields: label, type, bandwidth, cid, provider, …'),
      },
    },
    ({ path, kind, a, b, attributes }) =>
      applyEdit(path, (t) =>
        addLinkText(t, {
          kind,
          a: a as Record<string, unknown>,
          b: b as Record<string, unknown>,
          attributes: attributes as Record<string, unknown> | undefined,
        }),
      ),
  );

  server.registerTool(
    'remove_link',
    {
      title: TOOL_DOCS.remove_link.title,
      description: TOOL_DOCS.remove_link.description,
      inputSchema: {
        path: pathArg,
        kind: z.enum(['cable', 'circuit', 'logical']).describe('Link kind'),
        a_name: z.string().describe('Node name of one endpoint'),
        b_name: z.string().describe('Node name of the other endpoint'),
        match_index: z
          .number()
          .optional()
          .describe('Disambiguates parallel links (indexes come from the error message)'),
      },
    },
    ({ path, ...params }) => applyEdit(path, (t) => removeLinkText(t, params)),
  );

  server.registerTool(
    'set_position',
    {
      title: TOOL_DOCS.set_position.title,
      description: TOOL_DOCS.set_position.description,
      inputSchema: {
        path: pathArg,
        name: z.string().describe('Device / provider network / network segment name'),
        x: z.number().describe('Canvas x'),
        y: z.number().describe('Canvas y'),
      },
    },
    ({ path, name, x, y }) => applyEdit(path, (t) => setPositionText(t, name, x, y)),
  );

  return server;
}
