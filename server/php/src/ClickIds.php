<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Exception\ErrorMapper;
use Psr\Http\Message\MessageInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Click IDs (SPEC section 13): read them from requests, keep them in the web script's first-party cookie,
 * and find them in payment providers' payloads. Bound to a `clickIdParam` (`cgid` unless configured).
 */
final class ClickIds
{
    public const PATTERN = '/^clk_[0-9A-Z]{26}$/D';
    public const HEADER = 'Clikgate-Click-Id';
    /** The marker cookie: `_cg_kept=s` says the server kept the click ID, so goals report `server_cookie`. */
    public const MARKER = '_cg_kept';
    private const PAYMENT_KEYS = ['cg_click_id', 'cgid', 'clikgate_click_id'];
    private const CONTAINERS = ['metadata', 'meta', 'meta_data', 'note_attributes', 'attributes', 'custom_attributes', 'customAttributes'];

    /** @var \Closure(): string */
    private \Closure $param;

    /**
     * @param (callable(): string)|null $param
     */
    public function __construct(?callable $param = null)
    {
        $this->param = null === $param ? static fn(): string => 'cgid' : \Closure::fromCallable($param);
    }

    /** The query parameter in use. */
    public function paramName(): string
    {
        return ($this->param)();
    }

    /** `_cg_<param>`: the same first-party cookie the web script writes. */
    public function cookieName(): string
    {
        return '_cg_' . $this->paramName();
    }

    /**
     * True when `$id` is a Clikgate click ID (`clk_` + 26 characters).
     *
     * ```php
     * $clikgate->clickIds->isValid('clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6'); // true
     * ```
     */
    public static function isValid(mixed $id): bool
    {
        return \is_string($id) && 1 === preg_match(self::PATTERN, $id);
    }

    /**
     * Read the click ID: the query parameter, then the `_cg_<param>` cookie, then the `Clikgate-Click-Id` header.
     * Only valid IDs are returned.
     *
     * Accepts a PSR-7 `ServerRequestInterface`, a Symfony/Laravel `Request`, `['url' => …, 'headers' => […]]`,
     * or `null` for the current request (`$_SERVER`).
     *
     * ```php
     * $clickId = $clikgate->clickIds->fromRequest($request);   // save it with the application
     * ```
     */
    public function fromRequest(mixed $request = null): ?string
    {
        return $this->locate(self::parts($request))[0];
    }

    /**
     * The visitor context for a goal (SPEC 13.1): the click ID, how it was kept (`keptBy`) and the browser engine and
     * platform parsed from the `User-Agent` here in the SDK (the User-Agent itself is never sent). Spread it into the
     * goal options.
     *
     * - `keptBy` is `server_cookie` when the click ID came from the cookie with the `_cg_kept=s` marker,
     *   `script_cookie` from the cookie without it, `form` from the `Clikgate-Click-Id` header, and null otherwise
     *   (e.g. straight from the URL).
     *
     * ```php
     * $clikgate->goal('account_opened', ['reference' => $ref, ...$clikgate->clickIds->context($request)]);
     * ```
     *
     * @return array{clickId: ?string, keptBy: ?string, browserEngine: string, platform: string}
     */
    public function context(mixed $request = null): array
    {
        $parts = self::parts($request);
        [$clickId, $source] = $this->locate($parts);
        $keptBy = null;
        if ('cookie' === $source) {
            $keptBy = \in_array('s', self::cookieValues($parts[1]('cookie'), self::MARKER), true) ? 'server_cookie' : 'script_cookie';
        } elseif ('header' === $source) {
            $keptBy = 'form';
        }
        $ua = $parts[1]('user-agent');

        return ['clickId' => $clickId, 'keptBy' => $keptBy, 'browserEngine' => self::browserEngine($ua), 'platform' => self::platform($ua)];
    }

    /** The browser engine from a `User-Agent` (SPEC 13.1): `webkit_ios`, `gecko`, `chromium`, `safari_mac` or `other`. */
    public static function browserEngine(?string $userAgent): string
    {
        $ua = $userAgent ?? '';
        $has = static fn(string ...$needles): bool => array_reduce($needles, static fn(bool $c, string $n): bool => $c || str_contains($ua, $n), false);
        if ($has('iPhone', 'iPad', 'iPod')) {
            return 'webkit_ios';
        }
        if ($has('Firefox/')) {
            return 'gecko';
        }
        if ($has('Chrome/', 'Chromium/', 'Edg/', 'OPR/', 'SamsungBrowser/')) {
            return 'chromium';
        }
        if (str_contains($ua, 'Macintosh') && str_contains($ua, 'Safari/') && str_contains($ua, 'Version/')) {
            return 'safari_mac';
        }

        return 'other';
    }

    /** The platform from a `User-Agent` (SPEC 13.1): `ios`, `android`, `macos`, `windows`, `linux` or `other`. */
    public static function platform(?string $userAgent): string
    {
        $ua = $userAgent ?? '';
        $has = static fn(string ...$needles): bool => array_reduce($needles, static fn(bool $c, string $n): bool => $c || str_contains($ua, $n), false);

        return match (true) {
            $has('iPhone', 'iPad', 'iPod') => 'ios',
            $has('Android') => 'android',
            $has('Macintosh', 'Mac OS X') => 'macos',
            $has('Windows') => 'windows',
            $has('Linux', 'X11') => 'linux',
            default => 'other',
        };
    }

    /**
     * The `/cg/keep` route (SPEC 13.1): a PSR-15 request handler the web script's `data-server-endpoint="/cg/keep"`
     * posts to, so your server sets the click-ID cookie and the `_cg_kept=s` marker. `secure` defaults to true;
     * `days` must be 1-400. Needs `psr/http-server-handler` (brought by `psr/http-server-middleware`).
     *
     * ```php
     * $app->post('/cg/keep', $clikgate->clickIds->keepRoute());            // Slim, Mezzio, …
     * ```
     *
     * @param array<string, mixed> $options `days` (int, 1-400, default 30), `secure` (default true), `domain`
     */
    public function keepRoute(array $options = [], ?\Psr\Http\Message\ResponseFactoryInterface $responseFactory = null): Psr15\KeepRouteHandler
    {
        return new Psr15\KeepRouteHandler($this->keepRouteCore($options), $responseFactory);
    }

    /**
     * The framework-neutral core of the `/cg/keep` route (no PSR-15 needed): `respond($method, $headers, $body)`
     * returns the status and the headers to send.
     *
     * @param array<string, mixed> $options `days` (int, 1-400, default 30), `secure` (default true), `domain`
     */
    public function keepRouteCore(array $options = []): KeepRoute
    {
        return new KeepRoute($this, $options);
    }

    /**
     * @param array{0: string, 1: \Closure(string): ?string} $parts
     *
     * @return array{0: ?string, 1: ?string} the click ID and where it came from (`query`, `cookie`, `header`)
     */
    private function locate(array $parts): array
    {
        [$query, $header] = $parts;
        foreach (self::queryValues($query, $this->paramName()) as $v) {
            if (self::isValid($v)) {
                return [$v, 'query'];
            }
        }
        foreach (self::cookieValues($header('cookie'), $this->cookieName()) as $v) {
            if (self::isValid($v)) {
                return [$v, 'cookie'];
            }
        }
        $h = $header(self::HEADER);
        $h = null === $h ? null : trim($h);

        return self::isValid($h) ? [$h, 'header'] : [null, null];
    }

    /** The first valid click ID in the query string only (the add-ons persist only those). */
    public function fromQuery(mixed $request = null): ?string
    {
        [$query] = self::parts($request);
        foreach (self::queryValues($query, $this->paramName()) as $v) {
            if (self::isValid($v)) {
                return $v;
            }
        }

        return null;
    }

    /**
     * The `Set-Cookie` value that keeps the click ID: `SameSite=Lax`, `Secure` on HTTPS, not `HttpOnly`
     * (the web script reads it).
     *
     * ```php
     * $clikgate->clickIds->cookieHeader($clickId); // '_cg_cgid=clk_…; Path=/; Max-Age=2592000; SameSite=Lax; Secure'
     * ```
     *
     * @param array{days?: int|float, secure?: bool, domain?: string} $options
     */
    public function cookieHeader(string $id, array $options = []): string
    {
        if (!self::isValid($id)) {
            throw ErrorMapper::local('invalid_click_id', 'That is not a Clikgate click ID (clk_ + 26 characters).', 'click_id');
        }
        $days = $options['days'] ?? 30;
        $parts = [$this->cookieName() . '=' . $id, 'Path=/', 'Max-Age=' . (int) round($days * 86400)];
        if (isset($options['domain']) && '' !== $options['domain']) {
            $parts[] = 'Domain=' . $options['domain'];
        }
        $parts[] = 'SameSite=Lax';
        if ($options['secure'] ?? true) {
            $parts[] = 'Secure';
        }

        return implode('; ', $parts);
    }

    /**
     * The `Set-Cookie` value of the `_cg_kept=s` marker, with the same `Path`, `Max-Age`, `Domain`, `SameSite` and
     * `Secure` as the click-ID cookie.
     *
     * @param array{days?: int|float, secure?: bool, domain?: string} $options
     */
    public function markerHeader(array $options = []): string
    {
        $days = $options['days'] ?? 30;
        $parts = [self::MARKER . '=s', 'Path=/', 'Max-Age=' . (int) round($days * 86400)];
        if (isset($options['domain']) && '' !== $options['domain']) {
            $parts[] = 'Domain=' . $options['domain'];
        }
        $parts[] = 'SameSite=Lax';
        if ($options['secure'] ?? true) {
            $parts[] = 'Secure';
        }

        return implode('; ', $parts);
    }

    /**
     * Add the click-ID cookie to a response, keeping any `Set-Cookie` headers already there, then the `_cg_kept=s`
     * marker (same attributes) so the web script reports `kept_by: server_cookie`.
     *
     * - PSR-7 responses are immutable: the new response is returned.
     * - Symfony/Laravel responses are changed in place (and returned).
     * - A list of header lines is returned with the new line appended.
     * - `null` sends the header with `header()`.
     *
     * `secure` defaults to whether `$request` was HTTPS (`X-Forwarded-Proto` included), and to true when unknown.
     *
     * ```php
     * $response = $clikgate->clickIds->persist($response, $clickId, ['request' => $request]);
     * ```
     *
     * @param array{days?: int|float, secure?: bool, domain?: string, request?: mixed} $options
     *
     * @return mixed the response (a new instance for PSR-7)
     */
    public function persist(mixed $response, string $id, array $options = []): mixed
    {
        $cookieOptions = $options;
        unset($cookieOptions['request']);
        if (!isset($cookieOptions['secure'])) {
            $cookieOptions['secure'] = self::isSecure($options['request'] ?? null);
        }
        $values = [$this->cookieHeader($id, $cookieOptions), $this->markerHeader($cookieOptions)];
        if ($response instanceof MessageInterface) {
            foreach ($values as $value) {
                $response = $response->withAddedHeader('Set-Cookie', $value);
            }

            return $response;
        }
        if (\is_object($response) && property_exists($response, 'headers') && \is_object($response->headers) && method_exists($response->headers, 'set')) {
            foreach ($values as $value) {
                $response->headers->set('Set-Cookie', $value, false); // Symfony ResponseHeaderBag: replace = false appends
            }

            return $response;
        }
        if (\is_array($response)) {
            foreach ($values as $value) {
                $response[] = 'Set-Cookie: ' . $value;
            }

            return $response;
        }
        if (null === $response) {
            if (!headers_sent()) {
                foreach ($values as $value) {
                    header('Set-Cookie: ' . $value, false);
                }
            }

            return $response;
        }
        throw ErrorMapper::local('invalid_argument', 'persist() needs a PSR-7 or Symfony/Laravel response, a list of header lines, or null.', 'response');
    }

    /**
     * Find the click ID in a payment provider's payload: Paystack `metadata` (and `custom_fields`),
     * Flutterwave `meta`, Shopify note or cart attributes, WooCommerce order meta, or your own webhook.
     *
     * ```php
     * $clickId = $clikgate->clickIds->fromPaymentMetadata(json_decode($rawBody, true)); // a Paystack charge.success event
     * ```
     */
    public function fromPaymentMetadata(mixed $payload): ?string
    {
        $p = \is_string($payload) ? self::json($payload) : $payload;
        if (!\is_array($p) || array_is_list($p) && [] !== $p) {
            return null;
        }
        $candidates = [$p];
        if (\is_array($p['data'] ?? null) && !array_is_list($p['data'])) {
            $candidates[] = $p['data'];
        }
        foreach ($candidates as $c) {
            $own = self::pick($c);
            if (null !== $own) {
                return $own;
            }
            foreach (self::CONTAINERS as $name) {
                if (!isset($c[$name])) {
                    continue;
                }
                $found = self::pick(self::asMap($c[$name]));
                if (null !== $found) {
                    return $found;
                }
            }
        }

        return null;
    }

    private static function json(string $s): mixed
    {
        try {
            return json_decode($s, true, 512, \JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }
    }

    /** @return array<array-key, mixed>|null */
    private static function asMap(mixed $container): ?array
    {
        $c = \is_string($container) ? self::json($container) : $container;
        if (!\is_array($c)) {
            return null;
        }
        if (array_is_list($c)) {
            $m = [];
            foreach ($c as $item) {
                if (!\is_array($item)) {
                    continue;
                }
                $k = $item['name'] ?? $item['key'] ?? $item['variable_name'] ?? $item['display_name'] ?? null;
                if (\is_string($k)) {
                    $m[$k] = $item['value'] ?? null;
                }
            }

            return $m;
        }

        return $c;
    }

    /**
     * @param array<array-key, mixed>|null $m
     */
    private static function pick(?array $m, int $depth = 0): ?string
    {
        if (null === $m) {
            return null;
        }
        foreach (self::PAYMENT_KEYS as $k) {
            $v = $m[$k] ?? null;
            if (self::isValid($v)) {
                /** @var string $v */
                return $v;
            }
        }
        if (0 === $depth && \is_array($m['custom_fields'] ?? null) && array_is_list($m['custom_fields'])) {
            return self::pick(self::asMap($m['custom_fields']), 1);
        }

        return null;
    }

    /**
     * @return array{0: string, 1: \Closure(string): ?string} the query string and a case-insensitive header getter
     */
    private static function parts(mixed $request): array
    {
        if ($request instanceof ServerRequestInterface) {
            return [$request->getUri()->getQuery(), static fn(string $n): ?string => $request->hasHeader($n) ? implode('cookie' === strtolower($n) ? '; ' : ', ', $request->getHeader($n)) : null];
        }
        if (\is_array($request)) {
            $url = \is_string($request['url'] ?? null) ? $request['url'] : '';
            $headers = \is_array($request['headers'] ?? null) ? $request['headers'] : [];

            return [(string) parse_url($url, \PHP_URL_QUERY), self::mapGetter($headers)];
        }
        if (\is_object($request) && isset($request->headers) && \is_object($request->headers) && method_exists($request->headers, 'all') && method_exists($request, 'getQueryString')) {
            $all = $request->headers->all(); // Symfony/Laravel: lowercase names => list of values
            $query = $request->getQueryString();

            return [\is_string($query) ? $query : '', self::mapGetter(\is_array($all) ? $all : [])];
        }
        $server = $_SERVER;

        return [\is_string($server['QUERY_STRING'] ?? null) ? $server['QUERY_STRING'] : '', static function (string $n) use ($server): ?string {
            $v = $server['HTTP_' . strtoupper(str_replace('-', '_', $n))] ?? null;

            return \is_string($v) ? $v : null;
        }];
    }

    /**
     * @param array<array-key, mixed> $headers
     *
     * @return \Closure(string): ?string
     */
    private static function mapGetter(array $headers): \Closure
    {
        return static function (string $name) use ($headers): ?string {
            $values = [];
            foreach ($headers as $k => $v) {
                if (strtolower((string) $k) !== strtolower($name)) {
                    continue;
                }
                foreach (\is_array($v) ? $v : [$v] as $x) {
                    if (\is_scalar($x)) {
                        $values[] = (string) $x;
                    }
                }
            }

            return [] === $values ? null : implode('cookie' === strtolower($name) ? '; ' : ', ', $values);
        };
    }

    /** @return list<string> */
    private static function queryValues(string $query, string $name): array
    {
        $out = [];
        foreach ('' === $query ? [] : explode('&', $query) as $pair) {
            $kv = explode('=', $pair, 2);
            if (urldecode($kv[0]) === $name) {
                $out[] = urldecode($kv[1] ?? '');
            }
        }

        return $out;
    }

    /** @return list<string> */
    private static function cookieValues(?string $header, string $name): array
    {
        $out = [];
        foreach (null === $header ? [] : explode(';', $header) as $part) {
            $kv = explode('=', $part, 2);
            if (2 !== \count($kv) || trim($kv[0]) !== $name) {
                continue;
            }
            $v = trim($kv[1]);
            if (\strlen($v) >= 2 && str_starts_with($v, '"') && str_ends_with($v, '"')) {
                $v = substr($v, 1, -1);
            }
            $out[] = rawurldecode($v);
        }

        return $out;
    }

    private static function isSecure(mixed $request): bool
    {
        if (null === $request) {
            return true;
        }
        if ($request instanceof ServerRequestInterface) {
            $proto = $request->getHeaderLine('X-Forwarded-Proto');

            return '' !== $proto ? 'https' === strtolower(trim(explode(',', $proto)[0])) : 'http' !== $request->getUri()->getScheme();
        }
        if (\is_object($request) && method_exists($request, 'isSecure')) {
            return (bool) $request->isSecure();
        }
        [, $header] = self::parts($request);
        $proto = $header('x-forwarded-proto');

        return null === $proto || 'https' === strtolower(trim(explode(',', $proto)[0]));
    }
}
