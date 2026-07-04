/**
 * Golden-file compatibility tests (plan §6.2 ② — the centerpiece):
 * every fixture must parse, normalize to the committed expected output
 * byte-for-byte, be idempotent and byte-stable, and the normalized result
 * must validate against the published JSON Schema.
 */
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { parse } from '../src/parse';
import { serialize } from '../src/serialize';
import { topoJsonSchema } from '../src/generators/schema';
import { readFixture } from './helpers';

const LEGACY_FIXTURES = [
  'v3/wan-logical',
  'v4v5/dx-endpoint-ip',
  'v6v7/site-cloud',
  'v6v7/two-site-wan',
] as const;

const V1_FIXTURES = ['v1/canonical', 'v1/minimal'] as const;

const ajv = new Ajv({ allErrors: true });
const validateSchema = ajv.compile(topoJsonSchema as object);

describe.each([...LEGACY_FIXTURES])('legacy fixture %s', (rel) => {
  const text = readFixture(`${rel}.topo.json`);
  const expected = readFixture(`expected/${rel.replace('/', '__')}.topo.json`);

  it('parses successfully', () => {
    expect(() => parse(text)).not.toThrow();
  });

  it('normalizes to the committed expected output (byte-for-byte)', () => {
    expect(serialize(parse(text))).toBe(expected);
  });

  it('is byte-stable across two runs and idempotent', () => {
    const once = serialize(parse(text));
    expect(serialize(parse(text))).toBe(once);
    expect(serialize(parse(once))).toBe(once);
  });

  it('normalized output validates against schema/topodraft.schema.json', () => {
    const ok = validateSchema(JSON.parse(serialize(parse(text))));
    expect(validateSchema.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('the legacy input itself is NOT schema-valid (missing version)', () => {
    expect(validateSchema(JSON.parse(text))).toBe(false);
  });
});

describe.each([...V1_FIXTURES])('v1 canonical fixture %s', (rel) => {
  const text = readFixture(`${rel}.topo.json`);

  it('is a serializer fixed point: serialize(parse(x)) === x', () => {
    expect(serialize(parse(text))).toBe(text);
  });

  it('validates against schema/topodraft.schema.json as-is', () => {
    const ok = validateSchema(JSON.parse(text));
    expect(validateSchema.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
});
