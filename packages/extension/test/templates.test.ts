/**
 * Built-in templates must produce canonical, schema-valid, diagnostic-clean
 * v1 documents (plan §6.4: format-touching artifacts stay in lockstep).
 */
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { parse, serialize, topoJsonSchema, validate } from '@topodraft/core';
import { BUILTIN_TEMPLATES, templateText } from '../src/templates';

const ajv = new Ajv({ allErrors: true });
const schemaCheck = ajv.compile(topoJsonSchema as object);

describe.each(BUILTIN_TEMPLATES.map((t) => [t.id, t] as const))('template %s', (_id, template) => {
  const text = templateText(template);

  it('serializes to a canonical fixed point', () => {
    expect(serialize(parse(text))).toBe(text);
  });

  it('validates against the published schema', () => {
    const ok = schemaCheck(JSON.parse(text));
    expect(schemaCheck.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('produces no semantic diagnostics', () => {
    expect(validate(parse(text))).toEqual([]);
  });
});

describe('template inventory', () => {
  it('offers the empty canvas and both v7 builtin topologies', () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.id)).toEqual([
      'empty',
      'two-site-wan',
      'site-cloud-dx',
    ]);
  });
});
