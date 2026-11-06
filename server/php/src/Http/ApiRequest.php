<?php

declare(strict_types=1);

namespace Clikgate\Http;

/**
 * @internal A request as the resources (and the generated layer) describe it.
 *
 * @phpstan-type RequestOptions array{idempotencyKey?: string, timeout?: float, maxRetries?: int}
 */
final class ApiRequest
{
    public bool $hasBody = false;
    public mixed $body = null;
    public ?string $idempotencyKey = null;
    public ?float $timeout = null;
    public ?int $maxRetries = null;

    /**
     * @param array<string, mixed> $query
     */
    public function __construct(public readonly string $method, public readonly string $path, public readonly array $query = []) {}

    public function withBody(mixed $body): self
    {
        $this->hasBody = true;
        $this->body = $body;

        return $this;
    }

    /**
     * @param array<string, mixed> $options `idempotencyKey`, `timeout` (seconds), `maxRetries`
     */
    public function withOptions(array $options): self
    {
        if (isset($options['idempotencyKey']) && \is_string($options['idempotencyKey'])) {
            $this->idempotencyKey = $options['idempotencyKey'];
        }
        if (isset($options['timeout']) && (\is_int($options['timeout']) || \is_float($options['timeout']))) {
            $this->timeout = (float) $options['timeout'];
        }
        if (isset($options['maxRetries']) && \is_int($options['maxRetries'])) {
            $this->maxRetries = $options['maxRetries'];
        }

        return $this;
    }
}
