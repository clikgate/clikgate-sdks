<?php

declare(strict_types=1);

namespace Clikgate\Exception;

/**
 * Base class of every exception the SDK throws (SPEC section 5).
 *
 * ```php
 * try {
 *     $clikgate->goals->send('account_opened', ['reference' => 'APP-55231', 'value' => '2000000']);
 * } catch (\Clikgate\Exception\RateLimitException $e) {
 *     echo 'retry in ', $e->getRetryAfter(), ' s';
 * } catch (\Clikgate\Exception\InvalidRequestException $e) {
 *     echo $e->getErrorCode(), ' ', $e->getParam();
 * }
 * ```
 */
class ClikgateException extends \RuntimeException
{
    /**
     * @param array<string, mixed>|null $raw the raw `error` object from the API
     */
    public function __construct(
        string $message,
        private readonly string $errorCode,
        private readonly ?int $httpStatus = null,
        private readonly ?string $requestId = null,
        private readonly ?string $param = null,
        private readonly ?string $errorType = null,
        private readonly ?array $raw = null,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }

    /** Stable machine-readable code, e.g. `invalid_value`, `link_locked`, `network_error`. */
    public function getErrorCode(): string
    {
        return $this->errorCode;
    }

    /** The HTTP status, or null for local, network and timeout errors. */
    public function getHttpStatus(): ?int
    {
        return $this->httpStatus;
    }

    /** The request ID (`req_…`) to quote to Clikgate support, when the API answered. */
    public function getRequestId(): ?string
    {
        return $this->requestId;
    }

    /** The request field the error is about, when there is one. */
    public function getParam(): ?string
    {
        return $this->param;
    }

    /** The envelope `type` (`invalid_request`, `conflict`, …), or null for local errors. */
    public function getErrorType(): ?string
    {
        return $this->errorType;
    }

    /**
     * The raw `error` object from the API, including extra keys such as `required_plan`.
     *
     * @return array<string, mixed>|null
     */
    public function getRaw(): ?array
    {
        return $this->raw;
    }

    protected function rawValue(string $key): mixed
    {
        return $this->raw[$key] ?? null;
    }
}
