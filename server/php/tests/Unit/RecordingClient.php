<?php

declare(strict_types=1);

namespace Clikgate\Tests\Unit;

use Nyholm\Psr7\Response;
use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

/** A capturing PSR-18 client: records every request that reaches the HTTP layer. */
final class RecordingClient implements ClientInterface
{
    /** @var list<RequestInterface> */
    public array $requests = [];

    /** @var \Closure(RequestInterface): ResponseInterface */
    public \Closure $handler;

    public function __construct(?\Closure $handler = null)
    {
        $this->handler = $handler ?? static fn(): ResponseInterface => new Response(201, ['Content-Type' => 'application/json'], '{"object":"goal_event","id":"gev_1","counted":true}');
    }

    public function sendRequest(RequestInterface $request): ResponseInterface
    {
        $this->requests[] = $request;

        return ($this->handler)($request);
    }

    /** @return list<string> one header's value per recorded request */
    public function headers(string $name): array
    {
        $out = [];
        foreach ($this->requests as $r) {
            $out[] = $r->getHeaderLine($name);
        }

        return $out;
    }

    /** @return list<array<string, mixed>> */
    public function bodies(): array
    {
        $out = [];
        foreach ($this->requests as $r) {
            $body = (string) $r->getBody();
            if ('' !== $body) {
                /** @var array<string, mixed> $decoded */
                $decoded = json_decode($body, true, 512, \JSON_THROW_ON_ERROR);
                $out[] = $decoded;
            }
        }

        return $out;
    }
}
