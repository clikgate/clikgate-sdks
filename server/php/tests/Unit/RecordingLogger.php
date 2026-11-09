<?php

declare(strict_types=1);

namespace Clikgate\Tests\Unit;

use Psr\Log\AbstractLogger;

/** A PSR-3 logger that keeps every line with its level (debug included). */
final class RecordingLogger extends AbstractLogger
{
    /** @var list<array{string, string}> */
    public array $lines = [];

    public function log($level, string|\Stringable $message, array $context = []): void
    {
        $this->lines[] = [\is_string($level) ? $level : '', (string) $message];
    }

    /** @return list<string> */
    public function debugLines(): array
    {
        $out = [];
        foreach ($this->lines as [$level, $message]) {
            if ('debug' === $level) {
                $out[] = $message;
            }
        }

        return $out;
    }
}
