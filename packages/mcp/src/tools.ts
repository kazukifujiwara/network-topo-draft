/**
 * Pure tool logic for the TopoDraft MCP server (#11): text in, structured
 * results out. SDK assembly lives in server.ts and the process wiring
 * (fs, stdio transport) in mcp.ts — the same layering as the CLI (run.ts),
 * so everything here is unit-testable.
 *
 * Purpose (product vision): AI agents co-edit *.topo.json files as text.
 * These tools give any MCP client the same three primitives the editor
 * relies on — learn the format, read a topology, validate it — without
 * hand-crafting JSON or guessing field names.
 */
import { allVrfs, genSchemaDoc, parse, sitesList, toCanonical } from '@topodraft/core';
import type { Topology } from '@topodraft/core';
import { validateText } from '../../cli/src/run';
import type { CliDiagnostic } from '../../cli/src/run';

export type { CliDiagnostic } from '../../cli/src/run';

/** The canonical topology file extensions (spec: *.topo.json, alias *.topo). */
export const TOPO_FILE_RE = /\.topo(\.json)?$/;

/**
 * Tool metadata in one place so the vendor-name guard test can scan every
 * string an MCP client will see (same policy as templates / agent guide).
 */
export const TOOL_DOCS = {
  describe_format: {
    title: 'Describe the TopoDraft file format',
    description:
      'Returns the TopoDraft topology file format contract: editing rules, the published ' +
      'JSON Schema, and a minimal example for *.topo.json files. Read this once before ' +
      'writing or editing a topology file.',
  },
  read_topology: {
    title: 'Read a topology file',
    description:
      'Parses a *.topo.json / *.topo file and returns a summary (device/link counts, ' +
      'sites, VRFs, diagnostic counts) plus the canonical topology JSON.',
    pathDescription: 'Path to the topology file (*.topo.json or *.topo)',
  },
  validate_topology: {
    title: 'Validate a topology file',
    description:
      'Validates a *.topo.json / *.topo file and returns the same diagnostics as the ' +
      'editor: JSON syntax, topology shape, semantic rules, and unknown-field ' +
      'did-you-mean suggestions. Run this after every edit.',
    pathDescription: 'Path to the topology file (*.topo.json or *.topo)',
  },
} as const;

/** The format contract for agents (core genSchemaDoc: rules + schema + example). */
export function describeFormat(): string {
  return genSchemaDoc();
}

export interface TopologySummary {
  devices: number;
  provider_networks: number;
  networks: number;
  cables: number;
  circuits: number;
  logical_links: number;
  sites: string[];
  vrfs: string[];
  diagnostics: { errors: number; warnings: number };
}

export interface ReadTopologyResult {
  summary: TopologySummary;
  /** Canonical (serialize-ordered) topology value. */
  topology: Topology;
}

/**
 * Summary + canonical form of one document. Throws TopoParseError for text
 * that does not parse — the server maps that to an isError tool result
 * pointing at validate_topology.
 */
export function readTopologyText(text: string): ReadTopologyResult {
  const t = parse(text);
  const diagnostics = validateText(text);
  return {
    summary: {
      devices: t.devices.length,
      provider_networks: (t.provider_networks ?? []).length,
      networks: (t.networks ?? []).length,
      cables: (t.cables ?? []).length,
      circuits: (t.circuits ?? []).length,
      logical_links: (t.logical_links ?? []).length,
      sites: sitesList(t),
      vrfs: allVrfs(t),
      diagnostics: {
        errors: diagnostics.filter((d) => d.severity === 'error').length,
        warnings: diagnostics.filter((d) => d.severity === 'warning').length,
      },
    },
    topology: toCanonical(t),
  };
}

export interface ValidateTopologyResult {
  ok: boolean;
  diagnostics: CliDiagnostic[];
}

/** Full diagnostics for one document (shared with the CLI and the editor). */
export function validateTopologyText(text: string): ValidateTopologyResult {
  const diagnostics = validateText(text);
  return { ok: diagnostics.every((d) => d.severity !== 'error'), diagnostics };
}
