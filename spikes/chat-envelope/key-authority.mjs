// OFF-SERVICE key authority (stub). In production this is a separate process/app on
// another machine (ADR 0005 revisit). The chat service only sees the KeyAuthority
// interface below; master keys live ONLY inside this closure and are never returned.
//
// interface KeyAuthority {
//   currentVersion(): Promise<number>
//   wrap(dek: Buffer, aad: Buffer): Promise<{ wrapped: Buffer, version: number }>
//   unwrap(wrapped: Buffer, version: number, aad: Buffer): Promise<Buffer>
//   rewrap(wrapped: Buffer, fromVersion: number, aad: Buffer): Promise<{ wrapped, version }>
// }
// Admin surface (not used by the service hot path): rotate(), retire(version).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function createStubAuthority({ latencyMs = 0 } = {}) {
  const masters = new Map([[1, randomBytes(32)]]);
  let current = 1;
  const sim = { latencyMs, down: false };
  const gate = async () => {
    if (sim.down) throw new Error("authority unreachable");
    if (sim.latencyMs) await new Promise((r) => setTimeout(r, sim.latencyMs));
  };
  const seal = (v, dek, aad) => {
    const nonce = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", masters.get(v), nonce);
    c.setAAD(aad);
    const ct = Buffer.concat([c.update(dek), c.final()]);
    return Buffer.concat([nonce, ct, c.getAuthTag()]); // 12 + 32 + 16 = 60 bytes
  };
  const open = (v, wrapped, aad) => {
    const key = masters.get(v);
    if (!key) throw new Error(`master key v${v} retired/unknown`);
    const d = createDecipheriv("aes-256-gcm", key, wrapped.subarray(0, 12));
    d.setAAD(aad);
    d.setAuthTag(wrapped.subarray(wrapped.length - 16));
    return Buffer.concat([d.update(wrapped.subarray(12, wrapped.length - 16)), d.final()]);
  };
  return {
    sim,
    async currentVersion() { await gate(); return current; },
    async wrap(dek, aad) { await gate(); return { wrapped: seal(current, dek, aad), version: current }; },
    async unwrap(wrapped, version, aad) { await gate(); return open(version, wrapped, aad); },
    async rewrap(wrapped, from, aad) {
      await gate(); // DEK plaintext never leaves the authority on this path
      return { wrapped: seal(current, open(from, wrapped, aad), aad), version: current };
    },
    // admin
    rotate() { current += 1; masters.set(current, randomBytes(32)); return current; },
    retire(v) { if (v === current) throw new Error("cannot retire current"); masters.delete(v); },
  };
}
