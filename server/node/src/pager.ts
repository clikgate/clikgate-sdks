import type { ListPage } from './types.js';

/** An async iterator over every item of a list, fetching pages lazily. */
export interface PageIterator<T> extends AsyncIterable<T> {
  /** Collect up to `max` items (default: all). */
  toArray(max?: number): Promise<T[]>;
}

/** @internal Iterate pages: `fetch(cursor)` returns the page after `cursor` (`null` for the first). */
export function paginate<T>(fetch: (cursor: string | null) => Promise<ListPage<T>>): PageIterator<T> {
  async function* iterate(): AsyncGenerator<T> {
    let cursor: string | null = null;
    for (;;) {
      const page: ListPage<T> = await fetch(cursor);
      for (const item of page.data ?? []) yield item;
      if (!page.has_more || !page.next_cursor) return;
      cursor = page.next_cursor;
    }
  }
  return {
    [Symbol.asyncIterator]: iterate,
    async toArray(max = Number.POSITIVE_INFINITY) {
      const out: T[] = [];
      if (max <= 0) return out;
      for await (const item of iterate()) {
        out.push(item);
        if (out.length >= max) break;
      }
      return out;
    },
  };
}

/** @internal Copy `params` without `undefined` values. */
export function defined(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined) out[k] = v;
  return out;
}
