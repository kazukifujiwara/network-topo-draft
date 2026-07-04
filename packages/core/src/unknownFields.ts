/**
 * Unknown-field detection on the RAW parsed JSON (format spec §7: parse
 * loads what it can, and Diagnostics warns that unknown fields will be lost
 * on save). Runs before normalization because parse() silently drops these.
 *
 * Each finding carries a did-you-mean suggestion so text-editing AI agents
 * can self-correct from the Problems panel alone (e.g. "ip" → "ip_address").
 */

const TOP_LEVEL = ['$schema', 'version', 'devices', 'provider_networks', 'networks', 'cables', 'circuits', 'logical_links'];
const DEVICE = ['name', 'device_type', 'role', 'site', 'tenant', 'platform', 'vrfs', 'interfaces', 'config_context', 'position'];
const INTERFACE = ['name', 'ip_address', 'type', 'description', 'lag', 'vrf'];
const PROVIDER_NETWORK = ['name', 'provider', 'description', 'position'];
const NETWORK = ['name', 'prefix', 'vlan', 'fhrp', 'description', 'position'];
const FHRP = ['protocol', 'group', 'virtual_ip'];
const POSITION = ['x', 'y'];
const CABLE = ['a', 'b', 'type', 'bandwidth', 'status', 'label'];
const CIRCUIT = ['a', 'b', 'cid', 'provider', 'type', 'commit_rate', 'status'];
// top-level `vrf` on a logical link is valid legacy input (v3) — not unknown
const LOGICAL_LINK = ['a', 'b', 'link_id', 'vlan', 'label', 'description', 'vrf'];
const PHYSICAL_ENDPOINT = ['site', 'device', 'interface', 'provider_network'];
const LOGICAL_ENDPOINT = ['device', 'vrf', 'id', 'interface', 'ip_address', 'provider_network', 'network'];

export interface UnknownFieldFinding {
  /** JSON path to the unknown property (its key), e.g. ['logical_links', 0, 'a', 'ip'] */
  path: (string | number)[];
  field: string;
  /** the closest valid field name, when one is plausibly intended */
  suggestion?: string;
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const c of haystack) {
    if (c === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return i === needle.length;
}

/**
 * Closest valid field: prefix matches win (ip → ip_address), then common
 * abbreviations as a UNIQUE subsequence (vip → virtual_ip), then small typos.
 */
export function suggestField(field: string, known: string[]): string | undefined {
  const lower = field.toLowerCase();
  const prefix = known
    .filter((k) => {
      const kl = k.toLowerCase();
      // require ≥2 shared chars so single-letter fields (a, b, x, y) never match
      return Math.min(kl.length, lower.length) >= 2 && (kl.startsWith(lower) || lower.startsWith(kl));
    })
    .sort((x, y) => x.length - y.length)[0];
  if (prefix) return prefix;
  if (lower.length >= 3) {
    const subsequence = known.filter((k) => isSubsequence(lower, k.toLowerCase()));
    if (subsequence.length === 1) return subsequence[0];
  }
  let best: string | undefined;
  let bestDist = 3; // allow up to 2 edits
  for (const k of known) {
    const d = levenshtein(lower, k.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = k;
    }
  }
  return best;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Find unknown fields anywhere in a raw *.topo.json value. */
export function findUnknownFields(value: unknown): UnknownFieldFinding[] {
  const findings: UnknownFieldFinding[] = [];
  if (!isPlainObject(value)) return findings;

  const check = (obj: unknown, known: string[], path: (string | number)[]): void => {
    if (!isPlainObject(obj)) return;
    for (const key of Object.keys(obj)) {
      if (!known.includes(key)) {
        const suggestion = suggestField(key, known);
        findings.push({ path: [...path, key], field: key, ...(suggestion ? { suggestion } : {}) });
      }
    }
  };
  const checkArray = (
    arr: unknown,
    path: (string | number)[],
    fn: (item: unknown, itemPath: (string | number)[]) => void,
  ): void => {
    if (!Array.isArray(arr)) return;
    arr.forEach((item, i) => fn(item, [...path, i]));
  };

  check(value, TOP_LEVEL, []);
  checkArray(value.devices, ['devices'], (d, p) => {
    check(d, DEVICE, p);
    if (isPlainObject(d)) {
      checkArray(d.interfaces, [...p, 'interfaces'], (f, fp) => check(f, INTERFACE, fp));
      check(d.position, POSITION, [...p, 'position']);
      // config_context contents are free-form (spec §3.3) — never descend
    }
  });
  checkArray(value.provider_networks, ['provider_networks'], (pn, p) => {
    check(pn, PROVIDER_NETWORK, p);
    if (isPlainObject(pn)) check(pn.position, POSITION, [...p, 'position']);
  });
  checkArray(value.networks, ['networks'], (n, p) => {
    check(n, NETWORK, p);
    if (isPlainObject(n)) {
      check(n.fhrp, FHRP, [...p, 'fhrp']);
      check(n.position, POSITION, [...p, 'position']);
    }
  });
  const checkLinks = (
    key: 'cables' | 'circuits' | 'logical_links',
    linkKnown: string[],
    endpointKnown: string[],
  ): void =>
    checkArray(value[key], [key], (l, p) => {
      check(l, linkKnown, p);
      if (isPlainObject(l)) {
        check(l.a, endpointKnown, [...p, 'a']);
        check(l.b, endpointKnown, [...p, 'b']);
      }
    });
  checkLinks('cables', CABLE, PHYSICAL_ENDPOINT);
  checkLinks('circuits', CIRCUIT, PHYSICAL_ENDPOINT);
  checkLinks('logical_links', LOGICAL_LINK, LOGICAL_ENDPOINT);
  return findings;
}
