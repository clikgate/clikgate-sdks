<?php

declare(strict_types=1);

namespace Clikgate\Http;

use Clikgate\Exception\ClikgateNetworkException;
use Clikgate\Exception\ClikgateTimeoutException;

/** @internal One HTTP attempt. Implementations never follow redirects. */
interface Transport
{
    /**
     * @param array<string, string> $headers
     *
     * @throws ClikgateNetworkException|ClikgateTimeoutException
     */
    public function send(string $method, string $url, array $headers, ?string $body, float $timeout): RawResponse;
}
