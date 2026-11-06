<?php

declare(strict_types=1);

namespace Clikgate\Laravel\Http\Middleware;

use Clikgate\ClickIds;
use Clikgate\Clikgate as Client;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The `clikgate` middleware: makes `$request->clikgateClickId()` available, and keeps a click ID that arrives
 * in the query string in the first-party `_cg_<param>` cookie (last click wins, like the web script).
 *
 * ```php
 * Route::middleware('clikgate')->group(function () { … });            // or in bootstrap/app.php:
 * ->withMiddleware(fn (Middleware $m) => $m->web(append: ['clikgate']))
 * ```
 */
final class CaptureClickId
{
    public const ATTRIBUTE = 'clikgate.click_id';

    public function __construct(private readonly Application $app) {}

    public function handle(Request $request, \Closure $next): mixed
    {
        try {
            /** @var Client $client */
            $client = $this->app->make(Client::class);
            $helpers = $client->clickIds;
        } catch (\Throwable) {
            $helpers = new ClickIds(); // no API key yet: still capture with the default parameter (cgid)
        }
        $clickId = $helpers->fromRequest($request);
        $request->attributes->set(self::ATTRIBUTE, $clickId);
        $response = $next($request);
        $repository = $this->app->make('config');
        /** @var array{persist?: bool, days?: int, domain?: ?string} $cookie */
        $cookie = $repository instanceof \Illuminate\Contracts\Config\Repository ? (array) $repository->get('clikgate.cookie', []) : [];
        if (null !== $clickId && ($cookie['persist'] ?? true) && $response instanceof Response && $helpers->fromQuery($request) === $clickId) {
            $options = ['days' => $cookie['days'] ?? 30, 'request' => $request];
            if (isset($cookie['domain']) && '' !== $cookie['domain']) {
                $options['domain'] = $cookie['domain'];
            }
            $helpers->persist($response, $clickId, $options);
        }

        return $response;
    }
}
