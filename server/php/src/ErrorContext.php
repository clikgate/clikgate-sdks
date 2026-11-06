<?php

declare(strict_types=1);

namespace Clikgate;

/** What `onError` receives next to the exception (SPEC 9.5). Never values, metadata or consent. */
final class ErrorContext
{
    /**
     * @param string                                         $operation `goal`, `goals.batch` or `config`
     * @param list<array{goal: string, reference: string}> $events    references are `[redacted]` while private mode is on
     * @param bool                                           $dropped   true when the events won't be retried
     */
    public function __construct(public readonly string $operation, public readonly array $events, public readonly bool $dropped = true) {}
}
