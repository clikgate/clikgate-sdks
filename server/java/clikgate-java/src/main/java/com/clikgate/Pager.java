package com.clikgate;

import com.clikgate.model.Page;
import java.util.Iterator;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/** Lazily walks pages: the next page is fetched with the previous page's {@code next_cursor}. */
final class Pager<T> implements Iterable<T> {
  private final Function<@Nullable String, Page<T>> fetch;

  Pager(Function<@Nullable String, Page<T>> fetch) {
    this.fetch = fetch;
  }

  @Override
  public Iterator<T> iterator() {
    return new Iterator<T>() {
      private @Nullable Iterator<T> page;
      private @Nullable String cursor;
      private boolean last;

      @Override
      public boolean hasNext() {
        while (page == null || !page.hasNext()) {
          if (last) {
            return false;
          }
          Page<T> p = fetch.apply(cursor);
          List<T> data = p.getData();
          page = data.iterator();
          cursor = p.getNextCursor();
          last = !p.hasMore() || cursor == null || cursor.isEmpty();
        }
        return true;
      }

      @Override
      public T next() {
        if (!hasNext()) {
          throw new NoSuchElementException();
        }
        Iterator<T> p = page;
        if (p == null) {
          throw new NoSuchElementException();
        }
        return p.next();
      }
    };
  }
}
