/** Small host-side utilities. The sync-loop logic lives in documentSync.ts. */

const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function getNonce(): string {
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += NONCE_CHARS.charAt(Math.floor(Math.random() * NONCE_CHARS.length));
  }
  return out;
}
