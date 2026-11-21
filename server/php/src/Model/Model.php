<?php

declare(strict_types=1);

namespace Clikgate\Model;

/**
 * The base of every typed model: readonly camelCase properties, plus the wire JSON.
 *
 * Models are read-only. They implement `ArrayAccess` over the wire keys (`$link['short_url']`,
 * `$result['change_request']['id']`), so code written for the array results keeps working; nested values read that
 * way are plain arrays. `toArray()` (and `json_encode`) gives the wire JSON plus the fields the SDK adds (`amount`,
 * `created`). Unknown fields are kept.
 *
 * @implements \ArrayAccess<string, mixed>
 * @implements \IteratorAggregate<string, mixed>
 */
abstract class Model implements \ArrayAccess, \JsonSerializable, \IteratorAggregate, \Countable
{
    /** @var array<string, mixed> */
    private readonly array $wire;

    /** @param array<string, mixed> $data the wire JSON */
    public function __construct(array $data)
    {
        $this->wire = $data;
    }

    /**
     * The wire JSON plus the fields the SDK adds.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return array_replace($this->wire, $this->derived());
    }

    /**
     * Fields the SDK adds or replaces in `toArray()`.
     *
     * @return array<string, mixed>
     */
    protected function derived(): array
    {
        return [];
    }

    /** @return array<string, mixed> */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }

    public function offsetExists(mixed $offset): bool
    {
        return isset($this->toArray()[$offset]);
    }

    public function offsetGet(mixed $offset): mixed
    {
        return $this->toArray()[$offset] ?? null;
    }

    public function offsetSet(mixed $offset, mixed $value): void
    {
        throw new \LogicException(static::class . ' is read-only.');
    }

    public function offsetUnset(mixed $offset): void
    {
        throw new \LogicException(static::class . ' is read-only.');
    }

    /** @return \ArrayIterator<string, mixed> */
    public function getIterator(): \ArrayIterator
    {
        return new \ArrayIterator($this->toArray());
    }

    public function count(): int
    {
        return \count($this->toArray());
    }

    /** @param array<string, mixed> $d */
    protected static function str(array $d, string $k): ?string
    {
        $v = $d[$k] ?? null;

        return \is_string($v) ? $v : (\is_int($v) ? (string) $v : null);
    }

    /** @param array<string, mixed> $d */
    protected static function string(array $d, string $k): string
    {
        return self::str($d, $k) ?? '';
    }

    /** @param array<string, mixed> $d */
    protected static function int(array $d, string $k): ?int
    {
        $v = $d[$k] ?? null;

        return \is_int($v) ? $v : null;
    }

    /** @param array<string, mixed> $d */
    protected static function float(array $d, string $k): ?float
    {
        $v = $d[$k] ?? null;

        return \is_int($v) || \is_float($v) ? (float) $v : null;
    }

    /** @param array<string, mixed> $d */
    protected static function bool(array $d, string $k): ?bool
    {
        $v = $d[$k] ?? null;

        return \is_bool($v) ? $v : null;
    }

    /**
     * A JSON object as an array.
     *
     * @param array<string, mixed> $d
     *
     * @return array<string, mixed>|null
     */
    protected static function map(array $d, string $k): ?array
    {
        $v = $d[$k] ?? null;
        if (!\is_array($v)) {
            return null;
        }
        /** @var array<string, mixed> $v */
        return $v;
    }

    /**
     * A JSON list of objects.
     *
     * @param array<string, mixed> $d
     *
     * @return list<array<string, mixed>>
     */
    protected static function maps(array $d, string $k): array
    {
        $v = $d[$k] ?? null;
        $out = [];
        foreach (\is_array($v) ? $v : [] as $item) {
            if (\is_array($item)) {
                /** @var array<string, mixed> $item */
                $out[] = $item;
            }
        }

        return $out;
    }

    /**
     * A JSON list of strings.
     *
     * @param array<string, mixed> $d
     *
     * @return list<string>
     */
    protected static function strings(array $d, string $k): array
    {
        $v = $d[$k] ?? null;
        $out = [];
        foreach (\is_array($v) ? $v : [] as $item) {
            if (\is_string($item)) {
                $out[] = $item;
            }
        }

        return $out;
    }

    /**
     * Any decoded JSON value as a wire array (non-arrays give []).
     *
     * @return array<string, mixed>
     */
    public static function wire(mixed $data): array
    {
        if (!\is_array($data)) {
            return [];
        }
        /** @var array<string, mixed> $data */
        return $data;
    }
}
