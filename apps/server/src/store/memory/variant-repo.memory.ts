import type { Variant, VariantRepo } from "../ports.js";

/**
 * In-memory VariantRepo (dev + Vitest).
 *
 * Unbounded by design, matching the other memory repos: this backs a
 * short-lived dev process or a test run. Anything durable runs Postgres.
 */
export function createMemoryVariantRepo(): VariantRepo {
  const variants: Variant[] = [];

  return {
    async create(input) {
      const variant: Variant = {
        id: crypto.randomUUID(),
        name: input.name,
        ownerToken: input.ownerToken,
        baseGameId: input.baseGameId,
        // Copy so the caller can't mutate stored state through the input ref.
        cosmetics: { ...input.cosmetics },
        forkedFrom: input.forkedFrom ?? null,
        createdAt: new Date(),
      };
      variants.push(variant);
      return variant;
    },

    async findById(id) {
      return variants.find((v) => v.id === id);
    },

    async findByOwner(ownerToken, opts) {
      const owned = variants
        .filter((v) => v.ownerToken === ownerToken)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const offset = opts?.offset ?? 0;
      const limit = opts?.limit ?? 50;
      return owned.slice(offset, offset + limit);
    },

    async deleteByOwner(ownerToken) {
      let count = 0;
      for (let i = variants.length - 1; i >= 0; i--) {
        if (variants[i]!.ownerToken === ownerToken) {
          variants.splice(i, 1);
          count++;
        }
      }
      return count;
    },
  };
}
