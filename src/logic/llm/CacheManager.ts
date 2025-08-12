
import * as vscode from "vscode";
import { logInfo } from "./LLMLogger";

export class CacheManager<T> {
  private inMemoryCache: Map<string, T> = new Map();
  private inflight: Map<string, Promise<T>> = new Map();

  constructor(private cacheKeyPrefix: string) {}

  public async get(
    key: string,
    context: vscode.ExtensionContext
  ): Promise<T | undefined> {
    const persistentCache = context.globalState.get<Record<string, T>>(
      this.cacheKeyPrefix,
      {}
    );

    if (this.inMemoryCache.has(key)) {
      logInfo(`Cache hit for ${key.substring(0, 8)}...: memory`);
      return this.inMemoryCache.get(key);
    }

    if (persistentCache[key]) {
      logInfo(`Cache hit for ${key.substring(0, 8)}...: persistent`);
      this.inMemoryCache.set(key, persistentCache[key]);
      return persistentCache[key];
    }

    if (this.inflight.has(key)) {
      logInfo(`Inflight join for ${key.substring(0, 8)}...`);
      return this.inflight.get(key)!;
    }

    return undefined;
  }

  public async set(
    key: string,
    value: T,
    context: vscode.ExtensionContext
  ): Promise<void> {
    this.inMemoryCache.set(key, value);
    const persistentCache = context.globalState.get<Record<string, T>>(
      this.cacheKeyPrefix,
      {}
    );
    const updatedCache = { ...persistentCache, [key]: value };
    await context.globalState.update(this.cacheKeyPrefix, updatedCache);
  }

  public async wrap(
    key: string,
    context: vscode.ExtensionContext,
    factory: () => Promise<T>
  ): Promise<T> {
    const cachedValue = await this.get(key, context);
    if (cachedValue !== undefined) {
      return cachedValue;
    }

    const promise = factory();
    this.inflight.set(key, promise);

    try {
      const result = await promise;
      await this.set(key, result, context);
      return result;
    } finally {
      this.inflight.delete(key);
    }
  }

  public async clear(context: vscode.ExtensionContext): Promise<void> {
    this.inMemoryCache.clear();
    this.inflight.clear();
    await context.globalState.update(this.cacheKeyPrefix, {});
  }
}
