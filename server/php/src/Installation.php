<?php

declare(strict_types=1);

namespace Clikgate;

use Psr\Http\Message\ServerRequestInterface;

/**
 * An app installation from the `Clikgate-Installation` header (SPEC section 24.1).
 *
 * The mobile SDKs give the app a value `<app_id>:<installation_id>` to send to its own backend at sign-in and on
 * signed-in requests. It is not a secret. Pass it to `identifyUser(['installation' => …])`, so your server never needs
 * to know which Clikgate app ID belongs to which platform. The header only names the app installation: the customer
 * ID always comes from your own signed-in user, never from the request.
 *
 * ```php
 * $installation = Installation::parseHeader($request->getHeaderLine('Clikgate-Installation')); // ?Installation
 * ```
 */
final class Installation
{
    /** The header name the app sends to your backend. */
    public const HEADER = 'Clikgate-Installation';

    /** Longer header values are refused before they are looked at. */
    public const MAX_LENGTH = 128;

    /** `app_` + a 26-character ID, one colon, a lowercase UUID. */
    public const PATTERN = '/^(app_[0-9A-Z]{26}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/D';

    /**
     * @param string $appId          the Clikgate app ID (`app_…`)
     * @param string $installationId the SDK's installation ID (a lowercase UUID)
     */
    public function __construct(public readonly string $appId, public readonly string $installationId) {}

    /**
     * Parse a `Clikgate-Installation` header value. `null` for anything that isn't exactly
     * `<app_id>:<installation_id>` (after trimming, at most 128 characters, lowercase UUID). Never throws.
     *
     * ```php
     * $installation = Installation::parseHeader($value);   // ->appId, ->installationId, or null
     * ```
     */
    public static function parseHeader(mixed $value): ?self
    {
        if (!\is_string($value) || \strlen($value) > self::MAX_LENGTH) {
            return null;
        }
        if (1 !== preg_match(self::PATTERN, trim($value, " \t\r\n\f\v"), $m)) {
            return null;
        }

        return new self($m[1], $m[2]);
    }

    /**
     * An installation from the raw header (a string) or an `Installation` (from `fromRequest()` or the framework
     * add-ons), through the same strict check as `parseHeader()`; null for anything else. Never throws.
     *
     * ```php
     * $installation = Installation::from($request->clikgateInstallation());   // or Installation::from($headerValue)
     * ```
     */
    public static function from(mixed $value): ?self
    {
        if ($value instanceof self) {
            return self::parseHeader($value->appId . ':' . $value->installationId);
        }

        return self::parseHeader($value);
    }

    /**
     * The installation from a request's `Clikgate-Installation` header, or `null` when it is missing, invalid or sent
     * more than once. Accepts a PSR-7 `ServerRequestInterface`, a Symfony/Laravel `Request`, `['headers' => […]]`, or
     * `null` for the current request (`$_SERVER`). Never throws.
     *
     * ```php
     * $installation = Installation::fromRequest($request);
     * ```
     */
    public static function fromRequest(mixed $request = null): ?self
    {
        try {
            return self::parseHeader(self::headerValue($request));
        } catch (\Throwable) {
            return null;
        }
    }

    /** @return array{appId: string, installationId: string} spread into `identifyUser()` */
    public function toArray(): array
    {
        return ['appId' => $this->appId, 'installationId' => $this->installationId];
    }

    private static function headerValue(mixed $request): ?string
    {
        if ($request instanceof ServerRequestInterface) {
            return self::single($request->getHeader(self::HEADER));
        }
        if (\is_array($request)) {
            $headers = \is_array($request['headers'] ?? null) ? $request['headers'] : [];
            $values = [];
            foreach ($headers as $name => $value) {
                if (strtolower((string) $name) === strtolower(self::HEADER)) {
                    foreach (\is_array($value) ? $value : [$value] as $v) {
                        $values[] = $v;
                    }
                }
            }

            return self::single($values);
        }
        if (\is_object($request) && isset($request->headers) && \is_object($request->headers) && method_exists($request->headers, 'all')) {
            $values = $request->headers->all(strtolower(self::HEADER)); // Symfony/Laravel: a list of values

            return self::single(\is_array($values) ? $values : []);
        }
        if (null === $request) {
            $value = $_SERVER['HTTP_CLIKGATE_INSTALLATION'] ?? null;

            return \is_string($value) ? $value : null;
        }

        return null;
    }

    /** @param array<array-key, mixed> $values */
    private static function single(array $values): ?string
    {
        // Several headers with this name: refused, never guessed
        if (1 !== \count($values)) {
            return null;
        }
        $value = reset($values);

        return \is_string($value) ? $value : null;
    }
}
