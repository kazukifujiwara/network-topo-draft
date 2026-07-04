import { describe, expect, it } from 'vitest';
import { genSchemaDoc } from '@topodraft/core';
import { GUIDE_BEGIN, GUIDE_END, buildAgentGuideSection, upsertAgentGuide } from '../src/agentGuide';

describe('buildAgentGuideSection', () => {
  const section = buildAgentGuideSection();

  it('is a self-contained contract: markers, workflow, schema, example', () => {
    expect(section.startsWith(GUIDE_BEGIN)).toBe(true);
    expect(section.endsWith(GUIDE_END)).toBe(true);
    expect(section).toContain('ip_address');
    expect(section).toContain(genSchemaDoc()); // full schema inline — works offline
    expect(section).toContain('Problems');
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
