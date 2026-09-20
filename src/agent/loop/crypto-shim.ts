/**
 * Browser-safe stand-in for `node:crypto` (Obsidian plugin bundle).
 * Loop-guard fingerprints only need a stable digest, not cryptographic SHA-256.
 */

export function createHash(_algorithm: string): {
  update(chunk: string | Uint8Array): { digest(encoding: string): string };
  digest(encoding: string): string;
} {
  let data = '';
  const api = {
    update(chunk: string | Uint8Array) {
      data += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return api;
    },
    digest(_encoding: string) {
      let h = 2166136261;
      for (let i = 0; i < data.length; i++) {
        h ^= data.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const hex = (h >>> 0).toString(16).padStart(8, '0');
      return (hex + hex + hex + hex).slice(0, 32);
    },
  };
  return api;
}
