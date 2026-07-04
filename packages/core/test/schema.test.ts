/**
 * The published artifact schema/topodraft.schema.json must never drift from
 * its source of truth in core, and must enforce the structural rules of
 * format spec §3/§5.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { topoJsonSchema } from '../src/generators/schema';
import { REPO_ROOT } from './helpers';

const published = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'schema/topodraft.schema.json'), 'utf8'),
);
const ajv = new Ajv({ allErrors: true });
const check = ajv.compile(topoJsonSchema as object);

describe('published schema artifact', () => {
  it('schema/topodraft.schema.json equals the core source of truth', () => {
    expect(published).toEqual(JSON.parse(JSON.stringify(topoJsonSchema)));
  });

  it('is a valid draft-07 schema (ajv compiles it)', () => {
    expect(() => new Ajv().compile(published)).not.toThrow();
  });
});

describe('structural validation (spec §5)', () => {
  it('accepts the minimal document', () => {
    expect(check({ version: 1, devices: [] })).toBe(true);
  });

  it('requires version and devices', () => {
    expect(check({ devices: [] })).toBe(false);
    expect(check({ version: 1 })).toBe(false);
  });

  it('pins version to the constant 1', () => {
    expect(check({ version: 2, devices: [] })).toBe(false);
    expect(check({ version: '1', devices: [] })).toBe(false);
  });

  it('rejects unknown fields everywhere (additionalProperties: false)', () => {
    expect(check({ version: 1, devices: [], bogus: 1 })).toBe(false);
    expect(check({ version: 1, devices: [{ name: 'a', bogus: 1 }] })).toBe(false);
    expect(
      check({
        version: 1,
        devices: [{ name: 'a' }],
        cables: [{ a: { device: 'a', bogus: 1 }, b: { device: 'a' } }],
      }),
    ).toBe(false);
  });

  it('requires device and provider-network names', () => {
    expect(check({ version: 1, devices: [{}] })).toBe(false);
    expect(check({ version: 1, devices: [], provider_networks: [{}] })).toBe(false);
  });

  it('requires a and b on every link', () => {
    expect(check({ version: 1, devices: [], cables: [{}] })).toBe(false);
    expect(check({ version: 1, devices: [], circuits: [{ a: { device: 'x' } }] })).toBe(false);
    expect(check({ version: 1, devices: [], logical_links: [{ b: { device: 'x' } }] })).toBe(false);
  });

  it('endpoints must be {device,…} or {provider_network,…}, never a mix', () => {
    const cable = (ep: object) => ({ version: 1, devices: [], cables: [{ a: ep, b: { device: 'x' } }] });
    expect(check(cable({ device: 'x' }))).toBe(true);
    expect(check(cable({ provider_network: 'p' }))).toBe(true);
    expect(check(cable({}))).toBe(false);
    expect(check(cable({ device: 'x', provider_network: 'p' }))).toBe(false);
  });

  it('a logical provider-network endpoint allows id but not vrf', () => {
    const link = (ep: object) => ({
      version: 1,
      devices: [],
      logical_links: [{ a: ep, b: { device: 'x' } }],
    });
    expect(check(link({ provider_network: 'p', id: 'vc-1' }))).toBe(true);
    expect(check(link({ provider_network: 'p', vrf: 'X' }))).toBe(false);
  });

  it('position requires both numeric coordinates and nothing else', () => {
    const dev = (position: object) => ({ version: 1, devices: [{ name: 'a', position }] });
    expect(check(dev({ x: 1, y: 2 }))).toBe(true);
    expect(check(dev({ x: 1 }))).toBe(false);
    expect(check(dev({ x: 1, y: 2, z: 3 }))).toBe(false);
  });

  it('config_context accepts any object and rejects arrays/scalars', () => {
    const dev = (config_context: unknown) => ({
      version: 1,
      devices: [{ name: 'a', config_context }],
    });
    expect(check(dev({ anything: { nested: [1, 2, ''] } }))).toBe(true);
    expect(check(dev([1]))).toBe(false);
    expect(check(dev('x'))).toBe(false);
  });
});
