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

/** In-memory file system for the server under test (edit tools write back). */
const FILES: Record<string, string> = {
  'site-cloud.topo.json': fixture('v6v7/site-cloud.topo.json'),
  'broken.topo.json': '{ not json',
  'small.topo.json': JSON.stringify({
    version: 1,
    devices: [
      { name: 'rt-01', role: 'router', position: { x: 100, y: 60 } },
      { name: 'sw-01', role: 'switch', position: { x: 300, y: 60 } },
    ],
  }),
};

const IO = {
  readFile: (path: string): string => {
    const text = FILES[path];
    if (text === undefined) throw new Error(`ENOENT: no such file: ${path}`);
    return text;
  },
  writeFile: (path: string, text: string): void => {
    FILES[path] = text;
  },
};

let client: Client;

beforeAll(async () => {
  const server = createServer(IO, '0.0.0-test');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
});

const firstText = (r: unknown): string =>
  (((r as { content?: { type: string; text: string }[] }).content ?? [])[0] ?? { text: '' })
    .text;

const READ_TOOLS = ['describe_format', 'read_topology', 'render_svg', 'validate_topology'];
const EDIT_TOOLS = [
  'add_device',
  'add_link',
  'remove_device',
  'remove_link',
  'set_position',
  'update_device',
];

describe('tool listing', () => {
  it('exposes the four read tools and the six edit tools by default', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...EDIT_TOOLS, ...READ_TOOLS].sort());
    const read = tools.find((t) => t.name === 'read_topology');
    expect(read?.inputSchema.properties).toHaveProperty('path');
    const render = tools.find((t) => t.name === 'render_svg');
    expect(render?.inputSchema.properties).toHaveProperty('view');
  });

  it('--read-only leaves the edit tools unregistered entirely', async () => {
    const server = createServer(IO, '0.0.0-test', { readOnly: true });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const roClient = new Client({ name: 'ro-client', version: '0.0.0' });
    await roClient.connect(ct);
    const { tools } = await roClient.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(READ_TOOLS);
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

describe('MCP Apps wiring (#30): UI resource + render tool enrichment', () => {
  const FAKE_HTML = '<!DOCTYPE html><html><body><div id="root"></div></body></html>';
  let appsClient: Client;

  beforeAll(async () => {
    const server = createServer(IO, '0.0.0-test', { appHtml: FAKE_HTML });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    appsClient = new Client({ name: 'apps-client', version: '0.0.0' });
    await appsClient.connect(ct);
  });

  it('render_svg declares the widget via _meta.ui.resourceUri', async () => {
    const { tools } = await appsClient.listTools();
    const render = tools.find((t) => t.name === 'render_svg');
    expect((render?._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri).toBe(
      'ui://topodraft/canvas.html',
    );
  });

  it('the canvas resource reads back as text/html;profile=mcp-app', async () => {
    const r = await appsClient.readResource({ uri: 'ui://topodraft/canvas.html' });
    const item = r.contents[0] as { mimeType?: string; text?: string };
    expect(item.mimeType).toBe('text/html;profile=mcp-app');
    expect(item.text).toContain('<div id="root"');
  });

  it('render_svg delivers the widget contract in structuredContent, SVG stays in content', async () => {
    const r = await appsClient.callTool({
      name: 'render_svg',
      arguments: { path: 'site-cloud.topo.json', view: 'logical' },
    });
    expect(r.isError).toBeFalsy();
    expect(firstText(r).startsWith('<svg ')).toBe(true); // fallback untouched
    const sc = r.structuredContent as {
      topology?: { version?: number };
      view?: string;
      show_global?: boolean;
      underlay?: boolean;
    };
    expect(sc?.topology?.version).toBe(1);
    expect(sc?.view).toBe('logical');
    expect(sc?.show_global).toBe(true);
    expect(sc?.underlay).toBe(true);
  });

  it('without appHtml the server behaves exactly like v0.5.0', async () => {
    // `client` from the outer scope was built WITHOUT appHtml
    const { tools } = await client.listTools();
    const render = tools.find((t) => t.name === 'render_svg');
    expect(render?._meta).toBeUndefined();
    const r = await client.callTool({
      name: 'render_svg',
      arguments: { path: 'site-cloud.topo.json', view: 'logical' },
    });
    expect(r.structuredContent).toBeUndefined();
    expect(firstText(r).startsWith('<svg ')).toBe(true);
    const resources = await client.listResources().catch(() => ({ resources: [] }));
    expect(resources.resources).toHaveLength(0);
  });
});

describe('edit tools (#12): read → mutate → write back → diagnostics', () => {
  it('add_device writes the file and reports post-edit validation', async () => {
    const r = await client.callTool({
      name: 'add_device',
      arguments: { path: 'small.topo.json', name: 'fw-01', role: 'firewall' },
    });
    expect(r.isError).toBeFalsy();
    const parsed = JSON.parse(firstText(r));
    expect(parsed.applied).toContain('fw-01');
    expect(parsed.ok).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
    expect(FILES['small.topo.json']).toContain('"fw-01"');
  });

  it('add_link validates endpoints and the chain add → remove round-trips', async () => {
    const bad = await client.callTool({
      name: 'add_link',
      arguments: {
        path: 'small.topo.json',
        kind: 'cable',
        a: { device: 'rt-01' },
        b: { device: 'ghost' },
      },
    });
    expect(bad.isError).toBe(true);
    const add = await client.callTool({
      name: 'add_link',
      arguments: {
        path: 'small.topo.json',
        kind: 'cable',
        a: { device: 'rt-01' },
        b: { device: 'sw-01' },
        attributes: { type: 'cat6' },
      },
    });
    expect(add.isError).toBeFalsy();
    expect(FILES['small.topo.json']).toContain('"cables"');
    const remove = await client.callTool({
      name: 'remove_link',
      arguments: { path: 'small.topo.json', kind: 'cable', a_name: 'sw-01', b_name: 'rt-01' },
    });
    expect(remove.isError).toBeFalsy();
    expect(FILES['small.topo.json']).not.toContain('"cables"');
  });

  it('surfaces edit-tool failures as isError without writing', async () => {
    const before = FILES['small.topo.json'];
    const r = await client.callTool({
      name: 'update_device',
      arguments: { path: 'small.topo.json', name: 'ghost', role: 'router' },
    });
    expect(r.isError).toBe(true);
    expect(FILES['small.topo.json']).toBe(before);
  });
});
