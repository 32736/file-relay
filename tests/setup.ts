// Vitest setup: guarantee a full Web Crypto implementation on globalThis.
// The jsdom environment's crypto may lack `subtle`/`randomUUID`, while the
// Worker code under test relies on crypto.subtle and crypto.getRandomValues.
import { webcrypto } from 'node:crypto'

const cryptoGlobal = globalThis.crypto as Crypto | undefined
if (!cryptoGlobal || typeof cryptoGlobal.subtle === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  })
}

// jsdom does not implement matchMedia; provide a desktop-default stub so
// components can query viewport breakpoints.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}
