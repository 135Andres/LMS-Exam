import { LRUCache } from 'lru-cache';

// Lista de revocación de JWTs de sesión. Un JWT firmado no se puede "borrar"
// server-side — esto le da a /auth/logout un efecto inmediato guardando el
// jti revocado hasta que el propio JWT hubiera expirado de todos modos (TTL
// = tiempo restante hasta exp), así la entrada nunca sobrevive más que el
// token al que corresponde.
const revoked = new LRUCache<string, true>({
  max: 50_000,
  ttl: 24 * 60 * 60 * 1000, // límite superior defensivo; el TTL real por entrada lo fija revokeJti()
});

export function revokeJti(jti: string, expUnixSeconds: number): void {
  const ttlMs = expUnixSeconds * 1000 - Date.now();
  if (ttlMs <= 0) return; // ya expirado por su cuenta, no hace falta revocar
  revoked.set(jti, true, { ttl: ttlMs });
}

export function isJtiRevoked(jti: string): boolean {
  return revoked.has(jti);
}

// Solo para tests.
export function _clearRevocationListForTests(): void {
  revoked.clear();
}
