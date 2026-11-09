<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Exception\ErrorMapper;

/**
 * The `/cg/keep` route (SPEC 13.1). The web script's `data-server-endpoint="/cg/keep"` posts the click ID
 * from the page URL here, and this handler sets the first-party `_cg_<param>` cookie and the `_cg_kept=s` marker from
 * your own server. Safari, and every browser on iPhone, keeps a click ID saved by a script for up to 7 days (sometimes
 * less). When your server saves it, it lasts as long as you choose, up to the browser's limit.
 *
 * - Only `POST` from the same origin (`Sec-Fetch-Site: same-origin`, else an `Origin` equal to the request's host).
 * - The body is `{"click_id": "...", "page_click_id": "..."}` (at most 1024 bytes); both must be the same valid ID.
 * - The cookie name comes from your configuration (`clickIdParam`), never from the request.
 * - Every response is empty, `Cache-Control: no-store, private`, and never a redirect. Nothing is echoed or logged.
 *
 * This is the framework-neutral core every adapter calls: `$clikgate->clickIds->keepRoute()` wraps it in a PSR-15
 * handler (`Clikgate\Psr15\KeepRouteHandler`) and the Laravel package in `Route::clikgateKeep()`. Elsewhere, call
 * `respond()` and copy the status and headers.
 *
 * ```php
 * $out = $clikgate->clickIds->keepRouteCore(['days' => 90])->respond($method, $headers, $rawBody);
 * http_response_code($out['status']);
 * foreach ($out['headers'] as [$name, $value]) { header("{$name}: {$value}", false); }
 * ```
 */
final class KeepRoute
{
    public const MAX_BODY = 1024;
    public const CACHE_CONTROL = 'no-store, private';

    private readonly int $days;
    private readonly bool $secure;
    private readonly ?string $domain;

    /**
     * @param array<string, mixed> $options `days` (int, 1-400, default 30), `secure` (default true), `domain`
     */
    public function __construct(private readonly ClickIds $clickIds, array $options = [])
    {
        foreach (array_keys($options) as $k) {
            if (!\in_array($k, ['days', 'secure', 'domain'], true)) {
                throw ErrorMapper::local('invalid_argument', \sprintf('Unknown keepRoute() option "%s". Options: days, secure, domain.', $k), (string) $k);
            }
        }
        $days = $options['days'] ?? 30;
        if (!\is_int($days) || $days < 1 || $days > 400) {
            throw ErrorMapper::local('invalid_argument', 'days must be a whole number from 1 to 400 (browsers cap cookie lifetimes at 400 days).', 'days');
        }
        $this->days = $days;
        $this->secure = (bool) ($options['secure'] ?? true);
        $domain = $options['domain'] ?? null;
        $this->domain = \is_string($domain) && '' !== $domain ? $domain : null;
    }

    /**
     * The framework-neutral core: every adapter calls this.
     *
     * @param array<array-key, mixed> $headers request headers, names in any case, values a string or a list
     *
     * @return array{status: int, headers: list<array{0: string, 1: string}>} the status and the response headers in order
     */
    public function respond(string $method, array $headers, string $body): array
    {
        if ('POST' !== strtoupper($method)) {
            return self::out(405, [['Allow', 'POST']]);
        }
        $header = static function (string $name) use ($headers): ?string {
            foreach ($headers as $k => $v) {
                if (strtolower((string) $k) === $name) {
                    $v = \is_array($v) ? reset($v) : $v;

                    return \is_scalar($v) ? (string) $v : null;
                }
            }

            return null;
        };
        if (!self::sameOrigin($header('sec-fetch-site'), $header('origin'), $header('x-forwarded-host'), $header('host'))) {
            return self::out(403);
        }
        $id = self::clickId($body);
        if (null === $id) {
            return self::out(400);
        }
        $cookie = ['days' => $this->days, 'secure' => $this->secure];
        if (null !== $this->domain) {
            $cookie['domain'] = $this->domain;
        }

        return self::out(204, [['Set-Cookie', $this->clickIds->cookieHeader($id, $cookie)], ['Set-Cookie', $this->clickIds->markerHeader($cookie)]]);
    }

    private static function sameOrigin(?string $fetchSite, ?string $origin, ?string $forwardedHost, ?string $host): bool
    {
        if (null !== $fetchSite) {
            return 'same-origin' === strtolower(trim($fetchSite));
        }
        if (null === $origin) {
            return false;
        }
        $h = null !== $forwardedHost && '' !== trim($forwardedHost) ? trim(explode(',', $forwardedHost)[0]) : trim((string) $host);
        if ('' === $h) {
            return false;
        }
        $o = strtolower(trim($origin));
        $h = strtolower($h);

        return 'https://' . $h === $o || 'http://' . $h === $o;
    }

    private static function clickId(string $body): ?string
    {
        if (\strlen($body) > self::MAX_BODY) {
            return null;
        }
        try {
            $data = json_decode($body, false, 512, \JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }
        if (!$data instanceof \stdClass) {
            return null;
        }
        $id = $data->click_id ?? null;
        $page = $data->page_click_id ?? null;
        if (!\is_string($id) || !\is_string($page) || !ClickIds::isValid($id) || $id !== $page) {
            return null;
        }

        return $id;
    }

    /**
     * @param list<array{0: string, 1: string}> $headers
     *
     * @return array{status: int, headers: list<array{0: string, 1: string}>}
     */
    private static function out(int $status, array $headers = []): array
    {
        return ['status' => $status, 'headers' => [['Cache-Control', self::CACHE_CONTROL], ...$headers]];
    }
}
