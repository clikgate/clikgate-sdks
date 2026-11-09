<?php

declare(strict_types=1);

namespace Clikgate\Laravel\Http\Controllers;

use Clikgate\ClickIds;
use Clikgate\Clikgate as Client;
use Clikgate\KeepRoute;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The `/cg/keep` route (SPEC 13.1), registered with `Route::clikgateKeep('/cg/keep')`. The web script's
 * `data-server-endpoint="/cg/keep"` posts the click ID here and the response sets the `_cg_<param>` cookie and the
 * `_cg_kept=s` marker from your server. Days and domain come from `config/clikgate.php` (`cookie`); `Secure` is
 * always set unless `cookie.keep_secure` is false.
 *
 * The macro excludes Laravel's CSRF middleware for this route only: the route checks the origin itself
 * (`Sec-Fetch-Site: same-origin`, else `Origin` equal to the host), changes nothing but these two cookies, and
 * accepts nothing but a valid click ID.
 */
final class KeepClickId
{
    public function __construct(private readonly Application $app) {}

    public function __invoke(Request $request): Response
    {
        $route = $this->route();
        $body = '';
        if ('POST' === strtoupper($request->getMethod())) {
            $stream = $request->getContent(true);
            $read = \is_resource($stream) ? stream_get_contents($stream, KeepRoute::MAX_BODY + 1) : false;
            $body = \is_string($read) ? $read : '';
        }
        $out = $route->respond($request->getMethod(), $request->headers->all(), $body);
        $response = new Response('', $out['status']);
        foreach ($out['headers'] as [$name, $value]) {
            $response->headers->set($name, $value, 'Set-Cookie' !== $name);
        }

        return $response;
    }

    private function route(): KeepRoute
    {
        try {
            /** @var Client $client */
            $client = $this->app->make(Client::class);
            $helpers = $client->clickIds;
        } catch (\Throwable) {
            $helpers = new ClickIds(); // no API key yet: the default parameter (cgid)
        }
        $repository = $this->app->make('config');
        $cookie = $repository instanceof \Illuminate\Contracts\Config\Repository ? (array) $repository->get('clikgate.cookie', []) : [];
        $options = ['days' => \is_numeric($cookie['days'] ?? null) ? (int) $cookie['days'] : 30, 'secure' => (bool) ($cookie['keep_secure'] ?? true)];
        if (\is_string($cookie['domain'] ?? null) && '' !== $cookie['domain']) {
            $options['domain'] = $cookie['domain'];
        }

        return $helpers->keepRouteCore($options);
    }
}
