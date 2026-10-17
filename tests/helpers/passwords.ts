import type { PasswordStore } from '../../src/core/config.js';

export function memoryPasswordStore(initial: Record<string, string> = {}): PasswordStore {
  const passwords = new Map(Object.entries(initial));
  return {
    get: (account) => passwords.get(account) ?? null,
    set: (account, password) => {
      passwords.set(account, password);
    },
  };
}
