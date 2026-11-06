<?php

declare(strict_types=1);

namespace Clikgate\Http;

/**
 * Clock and sleep, replaceable for tests (SPEC section 18). Pass it as the `clock` option.
 *
 * ```php
 * $clikgate = new Clikgate(['clock' => new class implements Clock {
 *     public array $sleeps = [];
 *     public function nowMs(): int { return 1793016000000; }
 *     public function sleepMs(int $ms): void { $this->sleeps[] = $ms; }
 * }]);
 * ```
 */
interface Clock
{
    /** Milliseconds since the epoch. */
    public function nowMs(): int;

    /** Wait `$ms` milliseconds. */
    public function sleepMs(int $ms): void;
}
