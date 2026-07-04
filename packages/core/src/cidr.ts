/**
 * Minimal IPv4/CIDR math for diagnostics (prefix-containment warnings).
 * Anything unparseable (IPv6, host names, free text) yields null — callers
 * must treat null as "cannot determine" and stay silent.
 */

/** Dotted-quad IPv4 → uint32; a trailing /len is ignored. Null if invalid. */
export function parseIpv4(ip: string): number | null {
  const bare = ip.split('/')[0] ?? '';
  const parts = bare.trim().split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

/** True/false when determinable, null when either side is not IPv4 CIDR. */
export function ipv4InCidr(ip: string, cidr: string): boolean | null {
  const [base, lenStr] = cidr.trim().split('/');
  if (base === undefined || lenStr === undefined || !/^\d{1,2}$/.test(lenStr)) return null;
  const len = Number(lenStr);
  if (len < 0 || len > 32) return null;
  const baseN = parseIpv4(base);
  const ipN = parseIpv4(ip);
  if (baseN === null || ipN === null) return null;
  if (len === 0) return true;
  const mask = (0xffffffff << (32 - len)) >>> 0;
  return (baseN & mask) === (ipN & mask);
}
