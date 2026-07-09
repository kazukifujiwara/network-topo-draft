/**
 * Full client ⇄ server loop over the SDK's in-memory transport: what an MCP
 * client (Claude Code etc.) actually sees — tool listing, schemas, results,
 * and isError mapping — without spawning a process or touching the disk.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (p: string): string =>
  readFileSync(resolve(HERE, '../../../fixtures', p), 'utf8');

/** In-memory file system for the server under test. */
const FILES: Record<string, string> = {
  'site-cloud.topo.json': fixture('v6v7/site-cloud.topo.json'),
  'broken.topo.json': '{ not json',
};

let client: Client;

beforeAll(async () => {
  const server = createServer(
    {
      readFile: (path) => {
        const text = FILES[path];
        if (text === undefined) throw new Error(`ENOENT: no such file: ${path}`);
        return text;
      },
    },
    '0.0.0-test',
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
});

const firstText = (r: unknown): string =>
  (((r as { content?: { type: string; text: string }[] }).content ?? [])[0] ?? { text: '' })
    .text;

describe('tool listing', () => {
  it('exposes exactly the four read-only tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'describe_format',
      'read_topology',
      'render_svg',
      'validate_topology',
    ]);
    const read = tools.find((t) => t.name === 'read_topology');
    expect(read?.inputSchema.properties).toHaveProperty('path');
    const render = tools.find((t) => t.name === 'render_svg');
    expect(render?.inputSchema.properties).toHaveProperty('view');
  });
});

describe('tool calls', () => {
  it('describe_format returns the format contract', async () => {
    const r = await client.callTool({ name: 'describe_format', arguments: {} });
    expect(firstText(r)).toContain('JSON Schema');
  });

  it('read_topology returns summary + canonical topology for a real file', async () => {
    const r = await client.callTool({
      name: 'read_topology',
      arguments: { path: 'site-cloud.topo.json' },
    });
    expect(r.isError).toBeFalsy();
    const parsed = JSON.parse(firstText(r));
    expect(parsed.summary.devices).toBeGreaterThan(0);
    expect(parsed.topology.version).toBe(1);
  });

  it('validate_topology reports syntax problems with ok=false', async () => {
    const r = await client.callTool({
      name: 'validate_topology',
      arguments: { path: 'broken.topo.json' },
    });
    expect(r.isError).toBeFalsy(); // diagnostics are DATA, not a tool failure
    const parsed = JSON.parse(firstText(r));
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics[0].code).toBe('invalid-json');
  });

  it('render_svg returns the SVG image of the requested view', async () => {
    const r = await client.callTool({
      name: 'render_svg',
      arguments: { path: 'site-cloud.topo.json', view: 'logical' },
    });
    expect(r.isError).toBeFalsy();
    expect(firstText(r).startsWith('<svg ')).toBe(true);
    expect(firstText(r)).toContain('stroke-dasharray="1.5 6"');
  });

  it('rejects non-topology extensions with isError', async () => {
    const r = await client.callTool({
      name: 'read_topology',
      arguments: { path: 'notes.txt' },
    });
    expect(r.isError).toBe(true);
    expect(firstText(r)).toContain('not a topology file');
  });

  it('maps missing files to isError instead of crashing the server', async () => {
    const r = await client.callTool({
      name: 'read_topology',
      arguments: { path: 'ghost.topo.json' },
    });
    expect(r.isError).toBe(true);
    expect(firstText(r)).toContain('ENOENT');
  });
});
