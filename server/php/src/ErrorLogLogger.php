<?php

declare(strict_types=1);

namespace Clikgate;

use Psr\Log\AbstractLogger;
use Psr\Log\LogLevel;

/** The default logger: warnings and above to `error_log()`, prefixed `[clikgate]`. Never the context values. */
final class ErrorLogLogger extends AbstractLogger
{
    private const LEVELS = [LogLevel::EMERGENCY, LogLevel::ALERT, LogLevel::CRITICAL, LogLevel::ERROR, LogLevel::WARNING];

    /**
     * @param mixed[] $context
     */
    public function log($level, string|\Stringable $message, array $context = []): void
    {
        if (\in_array($level, self::LEVELS, true)) {
            $code = isset($context['clikgate_code']) && \is_string($context['clikgate_code']) ? " ({$context['clikgate_code']})" : '';
            error_log("[clikgate] {$level}: {$message}{$code}");
        }
    }
}
