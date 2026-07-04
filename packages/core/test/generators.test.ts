/**
 * Generator outputs are asserted against committed golden files produced from
 * the v6/v7 site-cloud fixture — v7-equivalent modulo the approved deltas
 * (canonical v1 embeds, injectable markdown date, JSON-only schema prose).
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { serialize } from '../src/serialize';
import { genMarkdown } from '../src/generators/markdown';
import { genForAi, schemaLegend } from '../src/generators/forAi';
import { genSchemaDoc, topoJsonSchema } from '../src/generators/schema';
import { genDrawio } from '../src/generators/drawio';
import { readFixture } from './helpers';

const topo = () => parse(readFixture('v6v7/site-cloud.topo.json'));

describe('genMarkdown', () => {
  it('matches the golden output for the site-cloud fixture (fixed date)', () => {
    expect(genMarkdown(topo(), { date: '2026-07-04' })).toBe(
      readFixture('expected/generators/site-cloud.md'),
    );
  });

  it('is deterministic for a fixed date', () => {
    expect(genMarkdown(topo(), { date: '2026-07-04' })).toBe(
      genMarkdown(topo(), { date: '2026-07-04' }),
    );
  });

  it('counts devices / links / sites like v7 and renders empty sections as _none_', () => {
    const md = genMarkdown(parse('{"version":1,"devices":[]}'), { date: '2026-07-04' });
    expect(md).toContain('0 devices · 0 links · 0 sites');
    expect(md).toContain('## Local Connections (Cables)\n\n_none_');
  });

  it('escapes pipes in cell values', () => {
    const md = genMarkdown(
      parse(JSON.stringify({ version: 1, devices: [{ name: 'a|b' }] })),
      { date: '2026-07-04' },
    );
    expect(md).toContain('a\\|b');
  });
});

describe('genForAi', () => {
  it('matches the golden output (legend + canonical v1 JSON)', () => {
    expect(genForAi(topo())).toBe(readFixture('expected/generators/site-cloud.for-ai.txt'));
  });

  it('embeds the exact canonical serialization inside the code fence', () => {
    const out = genForAi(topo());
    expect(out).toContain('```json\n' + serialize(topo()) + '```');
    expect(out).toContain(schemaLegend());
  });
});

describe('genSchemaDoc', () => {
  it('matches the golden output', () => {
    expect(genSchemaDoc()).toBe(readFixture('expected/generators/schema-doc.txt'));
  });

  it('embeds the published JSON Schema verbatim', () => {
    expect(genSchemaDoc()).toContain(JSON.stringify(topoJsonSchema, null, 2));
  });

  it('mentions neither YAML nor the removed Import button (ADR D2)', () => {
    expect(genSchemaDoc()).not.toMatch(/yaml/i);
    expect(genSchemaDoc()).not.toMatch(/import button/i);
  });

  it('its minimal example parses and is schema-consistent with version 1', () => {
    const example = /## Minimal valid example\n```json\n([\s\S]+?)\n```/.exec(genSchemaDoc());
    expect(example).not.toBeNull();
    const t = parse((example as RegExpExecArray)[1] as string);
    expect(t.version).toBe(1);
    expect(t.devices.length).toBeGreaterThan(0);
  });
});

describe('genDrawio', () => {
  it('matches the golden output for the site-cloud fixture', () => {
    expect(genDrawio(topo())).toBe(readFixture('expected/generators/site-cloud.drawio'));
  });

  it('is deterministic', () => {
    expect(genDrawio(topo())).toBe(genDrawio(topo()));
  });

  it('escapes XML special characters in labels', () => {
    const out = genDrawio(
      parse(JSON.stringify({ version: 1, devices: [{ name: 'a<b>&"c' }] })),
    );
    expect(out).toContain('a&lt;b&gt;&amp;&quot;c');
  });

  it('skips edges with dangling references instead of emitting broken cells', () => {
    const out = genDrawio(
      parse(
        JSON.stringify({
          version: 1,
          devices: [{ name: 'a' }],
          cables: [{ a: { device: 'a' }, b: { device: 'ghost' } }],
        }),
      ),
    );
    expect(out).not.toContain('edge="1"');
    expect(out).not.toContain('undefined');
  });
});
