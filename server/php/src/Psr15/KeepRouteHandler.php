<?php

declare(strict_types=1);

namespace Clikgate\Psr15;

use Clikgate\KeepRoute;
use Http\Discovery\Psr17FactoryDiscovery;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * The `/cg/keep` route as a PSR-15 request handler (SPEC 13.1, change 16): `$clikgate->clickIds->keepRoute()`.
 * Needs `psr/http-server-handler` (brought by `psr/http-server-middleware`). The response factory is found with
 * `php-http/discovery` unless you pass one.
 *
 * ```php
 * $app->any('/cg/keep', $clikgate->clickIds->keepRoute(['days' => 90]));   // Slim: every method reaches it (405 itself)
 * ```
 */
final class KeepRouteHandler implements RequestHandlerInterface
{
    public function __construct(private readonly KeepRoute $route, private readonly ?ResponseFactoryInterface $responseFactory = null) {}

    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        $body = '';
        if ('POST' === strtoupper($request->getMethod())) {
            $stream = $request->getBody();
            while (!$stream->eof() && \strlen($body) <= KeepRoute::MAX_BODY) {
                $chunk = $stream->read(KeepRoute::MAX_BODY + 1 - \strlen($body));
                if ('' === $chunk) {
                    break;
                }
                $body .= $chunk;
            }
        }
        $out = $this->route->respond($request->getMethod(), $request->getHeaders(), $body);
        $response = ($this->responseFactory ?? Psr17FactoryDiscovery::findResponseFactory())->createResponse($out['status']);
        foreach ($out['headers'] as [$name, $value]) {
            $response = $response->withAddedHeader($name, $value);
        }

        return $response;
    }
}
