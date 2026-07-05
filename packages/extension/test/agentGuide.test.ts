import { describe, expect, it } from 'vitest';
import { genSchemaDoc } from '@topodraft/core';
import {
  GUIDE_BEGIN,
  GUIDE_END,
  buildAgentGuideSection,
  buildNetboxGuideSection,
  upsertAgentGuide,
  upsertNetboxGuide,
} from '../src/agentGuide';

describe('buildAgentGuideSection', () => {
  const section = buildAgentGuideSection();

  it('is a self-contained contract: markers, workflow, schema, example', () => {
    expect(section.startsWith(GUIDE_BEGIN)).toBe(true);
    expect(section.endsWith(GUIDE_END)).toBe(true);
    expect(section).toContain('ip_address');
    expect(section).toContain(genSchemaDoc()); // full schema inline — works offline
    expect(section).toContain('Problems');
  });

  it('teaches creation rules: use this format for network diagrams, name files *.topo.json', () => {
    expect(section).toContain('MUST end in `.topo.json`');
    expect(section).toContain('Do NOT reach for image or generic diagram tools');
    expect(section).toContain('"$schema"'); // skeleton for new files
  });
});

describe('NetBox notes are opt-in (not every user runs NetBox)', () => {
  it('the default guide contains no NetBox section', () => {
    const section = buildAgentGuideSection();
    expect(section).not.toContain('topodraft:netbox-guide');
    expect(section).not.toContain('NetBox mapping');
  });

  it('the NetBox section is self-contained with the field-tested pitfalls', () => {
    const nb = buildNetboxGuideSection();
    expect(nb).toContain('topodraft:netbox-guide:begin');
    expect(nb).toContain('LAG interfaces'); // cables cannot terminate on LAGs
    expect(nb).toContain('termination_type'); // NetBox 4.x circuit terminations
    expect(nb).toContain('group_id');
  });

  it('upsertNetboxGuide coexists with the core guide and regenerates in place', () => {
    let content = upsertAgentGuide(null);
    content = upsertNetboxGuide(content);
    expect(content).toContain('topodraft:agent-guide:begin');
    expect(content).toContain('topodraft:netbox-guide:begin');
    // idempotent for both sections, in any order
    expect(upsertNetboxGuide(content)).toBe(content);
    expect(upsertAgentGuide(content)).toBe(content);
  });
});

describe('upsertAgentGuide', () => {
  it('creates the file content when none exists', () => {
    const out = upsertAgentGuide(null);
    expect(out.startsWith(GUIDE_BEGIN)).toBe(true);
    expect(out.endsWith(GUIDE_END + '\n')).toBe(true);
  });

  it('appends to an existing AGENTS.md without touching other content', () => {
    const out = upsertAgentGuide('# My project\n\nBuild with make.\n');
    expect(out.startsWith('# My project')).toBe(true);
    expect(out).toContain('Build with make.');
    expect(out.indexOf(GUIDE_BEGIN)).toBeGreaterThan(0);
  });

  it('replaces its own section in place (idempotent regeneration)', () => {
    const v1 = upsertAgentGuide('# Mine\n') + '\n## After section\nkeep me\n';
    const stale = v1.replace('ip_address', 'OUTDATED_CONTENT');
    const v2 = upsertAgentGuide(stale);
    expect(v2).toContain('# Mine');
    expect(v2).toContain('keep me');
    expect(v2).not.toContain('OUTDATED_CONTENT');
    expect(v2.match(new RegExp(GUIDE_BEGIN, 'g'))).toHaveLength(1);
    // running again changes nothing
    expect(upsertAgentGuide(v2)).toBe(v2);
  });
});
