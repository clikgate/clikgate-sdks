<?php

declare(strict_types=1);

namespace Clikgate\Exception;

/** 429. `getRetryAfter()` is the number of seconds from `Retry-After`, or null. */
class RateLimitException extends ClikgateException
{
    /**
     * @param array<string, mixed>|null $raw
     */
    public function __construct(string $message, string $errorCode, ?int $httpStatus = null, ?string $requestId = null, ?string $param = null, ?string $errorType = null, ?array $raw = null, private readonly ?int $retryAfter = null)
    {
        parent::__construct($message, $errorCode, $httpStatus, $requestId, $param, $errorType, $raw);
    }

    /** Seconds from `Retry-After`, or null. */
    public function getRetryAfter(): ?int
    {
        return $this->retryAfter;
    }
}
