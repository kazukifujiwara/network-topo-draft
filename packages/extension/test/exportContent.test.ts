import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TopoParseError, genDrawio, genForAi, genSchemaDoc, parse } from '@topodraft/core';
import { exportContent } from '../src/exportContent';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  resolve(HERE, '../../../fixtures/v6v7/site-cloud.topo.json'),
  'utf8',
);

describe('exportContent', () => {
  it('markdown wraps genMarkdown with the right language and name', () => {
    const r = exportContent('markdown', FIXTURE);
    expect(r.content).toContain('# Network Configuration');
    expect(r.language).toBe('markdown');
    expect(r.suggestedName('dallas-dc')).toBe('dallas-dc.md');
  });

  it('for-ai matches genForAi output', () => {
    const r = exportContent('for-ai', FIXTURE);
    expect(r.content).toBe(genForAi(parse(FIXTURE)));
    expect(r.suggestedName('x')).toBe('x-for-ai.md');
  });

  it('schema is the agent import spec, independent of the document', () => {
    expect(exportContent('schema', '{ even broken json is fine }').content).toBe(genSchemaDoc());
  });

  it('drawio matches genDrawio with an xml preview language', () => {
    const r = exportContent('drawio', FIXTURE);
    expect(r.content).toBe(genDrawio(parse(FIXTURE)));
    expect(r.language).toBe('xml');
    expect(r.suggestedName('site')).toBe('site.drawio');
  });

  it('throws TopoParseError for invalid documents (except schema)', () => {
    expect(() => exportContent('markdown', '{ nope')).toThrow(TopoParseError);
    expect(() => exportContent('drawio', '{}')).toThrow(TopoParseError);
  });
});
