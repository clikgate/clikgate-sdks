<?php

declare(strict_types=1);

namespace Clikgate\Model;

/**
 * One page of a list: `data` (typed models), `hasMore` and `nextCursor`. `$page['data']` gives the wire items.
 *
 * @template T of Model
 */
final class Page extends Model
{
    /** @var list<T> */
    public readonly array $data;
    public readonly bool $hasMore;
    public readonly ?string $nextCursor;

    /**
     * @param array<string, mixed>               $wire
     * @param callable(array<string, mixed>): T $map
     */
    public function __construct(array $wire, callable $map)
    {
        parent::__construct($wire);
        $this->data = array_map(static fn(array $item): Model => $map($item), self::maps($wire, 'data'));
        $this->hasMore = self::bool($wire, 'has_more') ?? false;
        $this->nextCursor = self::str($wire, 'next_cursor');
    }

    protected function derived(): array
    {
        return ['data' => array_map(static fn(Model $m): array => $m->toArray(), $this->data)];
    }
}
