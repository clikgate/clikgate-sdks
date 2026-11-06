<?php

declare(strict_types=1);

namespace Clikgate\Http;

/** @internal The raw answer of one attempt. Header names are lowercase. */
final class RawResponse
{
    /**
     * @param array<string, string> $headers
     */
    public function __construct(public readonly int $status, public readonly array $headers, public readonly string $body) {}

    public function json(): mixed
    {
        if ('' === trim($this->body)) {
            return null;
        }

        return json_decode($this->body, true, 512, \JSON_THROW_ON_ERROR | \JSON_BIGINT_AS_STRING);
    }
}
