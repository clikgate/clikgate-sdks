<?php

declare(strict_types=1);

namespace Clikgate\Psr15;

use Clikgate\ClickIds;
use Clikgate\Clikgate;
use Clikgate\Installation;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * PSR-15 middleware (SPEC section 17): sets the request attributes `clikgate.click_id` and `clikgate.installation`
 * (the app's `Clikgate-Installation` header as an `Installation`, or null when missing or invalid), and adds the first-party
 * `_cg_<param>` cookie to the response when the click ID came in the query string (last click wins).
 * Needs `psr/http-server-middleware`.
 *
 * ```php
 * $app->add(new \Clikgate\Psr15\ClikgateMiddleware($clikgate));       // Slim, Mezzio, …
 * $clickId = $request->getAttribute('clikgate.click_id');
 * $installation = $request->getAttribute('clikgate.installation');   // ?Installation
 * ```
 */
final class ClikgateMiddleware implements MiddlewareInterface
{
    public const ATTRIBUTE = 'clikgate.click_id';
    public const INSTALLATION_ATTRIBUTE = 'clikgate.installation';
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
        $response = $handler->handle(
            $request->withAttribute(self::ATTRIBUTE, $clickId)->withAttribute(self::INSTALLATION_ATTRIBUTE, Installation::fromRequest($request)),
        );
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
