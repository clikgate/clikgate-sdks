<?php

declare(strict_types=1);

namespace Clikgate\Http;

use Clikgate\Exception\ClikgateNetworkException;
use Clikgate\Exception\ClikgateTimeoutException;
use Psr\Http\Client\ClientExceptionInterface;
use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestFactoryInterface;
use Psr\Http\Message\StreamFactoryInterface;

/**
 * @internal Sends through any PSR-18 client (Guzzle, Symfony HttpClient, …). PSR-18 has no timeout or proxy
 * settings: configure them on the client you pass (the SDK's `timeout` and `proxy` don't apply to it).
 */
final class Psr18Transport implements Transport
{
    public function __construct(
        private readonly ClientInterface $client,
        private readonly RequestFactoryInterface $requests,
        private readonly StreamFactoryInterface $streams,
    ) {}

    public function send(string $method, string $url, array $headers, ?string $body, float $timeout): RawResponse
    {
        $request = $this->requests->createRequest($method, $url);
        foreach ($headers as $k => $v) {
            $request = $request->withHeader($k, $v);
        }
        if (null !== $body) {
            $request = $request->withBody($this->streams->createStream($body));
        }
        try {
            $response = $this->client->sendRequest($request);
        } catch (ClientExceptionInterface $e) {
            if (1 === preg_match('/timed? ?out|timeout/i', $e->getMessage())) {
                throw new ClikgateTimeoutException('The request timed out.', 'timeout', previous: $e);
            }
            throw new ClikgateNetworkException(\sprintf('Could not reach the Clikgate API (%s).', $e::class), 'network_error', previous: $e);
        }
        $out = [];
        foreach ($response->getHeaders() as $k => $values) {
            $out[strtolower((string) $k)] = implode(', ', $values);
        }

        return new RawResponse($response->getStatusCode(), $out, (string) $response->getBody());
    }
}
