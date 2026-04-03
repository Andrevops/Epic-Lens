import type { IssueData } from "../types";

interface CacheEntry {
  data: Partial<IssueData>;
  expires: number;
}

/**
 * Simple in-memory TTL cache for Jira issue statuses.
 */
export class StatusCache {
  private _cache = new Map<string, CacheEntry>();
  private _ttlMs: number;

  constructor(ttlSeconds: number) {
    this._ttlMs = ttlSeconds * 1000;
  }

  get(key: string): Partial<IssueData> | undefined {
    const entry = this._cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this._cache.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key: string, data: Partial<IssueData>): void {
    this._cache.set(key, {
      data,
      expires: Date.now() + this._ttlMs,
    });
  }

  setMany(entries: Map<string, Partial<IssueData>>): void {
    for (const [key, data] of entries) {
      this.set(key, data);
    }
  }

  /**
   * Returns keys that are NOT in cache or expired.
   */
  getMissingKeys(keys: string[]): string[] {
    return keys.filter((k) => this.get(k) === undefined);
  }

  clear(): void {
    this._cache.clear();
  }

  updateTtl(ttlSeconds: number): void {
    this._ttlMs = ttlSeconds * 1000;
  }

  get size(): number {
    return this._cache.size;
  }
}
