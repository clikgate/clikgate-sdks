<?php

declare(strict_types=1);

namespace Clikgate\Psr15;

use Clikgate\ClickIds;
use Clikgate\Clikgate;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * PSR-15 middleware (SPEC section 17): sets the request attribute `clikgate.click_id`, and adds the first-party
 * `_cg_<param>` cookie to the response when the click ID came in the query string (last click wins).
 * Needs `psr/http-server-middleware`.
 *
 * ```php
 * $app->add(new \Clikgate\Psr15\ClikgateMiddleware($clikgate));       // Slim, Mezzio, …
 * $clickId = $request->getAttribute('clikgate.click_id');
 * ```
 */
final class ClikgateMiddleware implements MiddlewareInterface
{
    public const ATTRIBUTE = 'clikgate.click_id';
    private readonly ClickIds $helpers;

    /**
     * @param array{persist?: bool, days?: int|float, domain?: string} $options
     */
    public function __construct(?Clikgate $client = null, private readonly array $options = [])
    {
        $this->helpers = null !== $client ? $client->clickIds : new ClickIds();
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $clickId = $this->helpers->fromRequest($request);
        $response = $handler->handle($request->withAttribute(self::ATTRIBUTE, $clickId));
        if (null !== $clickId && ($this->options['persist'] ?? true) && $this->helpers->fromQuery($request) === $clickId) {
            $cookie = ['request' => $request];
            if (isset($this->options['days'])) {
                $cookie['days'] = $this->options['days'];
            }
            if (isset($this->options['domain'])) {
                $cookie['domain'] = $this->options['domain'];
            }
            $persisted = $this->helpers->persist($response, $clickId, $cookie);
            if ($persisted instanceof ResponseInterface) {
                $response = $persisted;
            }
        }

        return $response;
    }
}
