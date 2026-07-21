import { describe, it, expect, beforeEach } from 'vitest';
import { revokeJti, isJtiRevoked, _clearRevocationListForTests } from './session-revocation.js';

describe('session-revocation', () => {
  beforeEach(() => {
    _clearRevocationListForTests();
  });

  it('un jti no revocado no está en la lista', () => {
    expect(isJtiRevoked('never-seen')).toBe(false);
  });

  it('revokeJti marca el jti como revocado', () => {
    const expInOneHour = Math.floor(Date.now() / 1000) + 3600;
    revokeJti('jti-a', expInOneHour);
    expect(isJtiRevoked('jti-a')).toBe(true);
    expect(isJtiRevoked('jti-b')).toBe(false);
  });

  it('un jti con exp ya pasado no se agrega (ya está vencido de todos modos)', () => {
    const expInThePast = Math.floor(Date.now() / 1000) - 60;
    revokeJti('jti-past', expInThePast);
    expect(isJtiRevoked('jti-past')).toBe(false);
  });
});
