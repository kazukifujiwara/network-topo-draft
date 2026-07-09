/**
 * MCP server assembly (#11): registers the TopoDraft tools on an McpServer.
 * File access is injected so tests can drive the full client ⇄ server loop
 * over an in-memory transport without touching the disk; only mcp.ts binds
 * the real file system and the stdio transport.
 *
 * Read-only by design for v1 (issue #12 tracks edit tools): local file
 * access only, no network, no telemetry.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { TopoParseError } from '@topodraft/core';
import {
  TOOL_DOCS,
  TOPO_FILE_RE,
  describeFormat,
  readTopologyText,
  validateTopologyText,
} from './tools';

export interface ServerIo {
  /** Read a file as UTF-8; throw on failure. */
  readFile(path: string): string;
}

const text = (s: string): CallToolResult => ({ content: [{ type: 'text', text: s }] });
const errorText = (s: string): CallToolResult => ({
  content: [{ type: 'text', text: s }],
  isError: true,
});

export function createServer(io: ServerIo, version: string): McpServer {
  const server = new McpServer({ name: 'topodraft', version });

  const readTopoFile = (path: string): string => {
    if (!TOPO_FILE_RE.test(path)) {
      throw new Error(`not a topology file (expected *.topo.json or *.topo): ${path}`);
    }
    return io.readFile(path);
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

  return server;
}
