<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Exception\ConfigurationException;
use Clikgate\Exception\ErrorMapper;

/**
 * Identity tokens (SDK spec 8.5): your server proves to Clikgate that a customer ID belongs to the
 * person signed in to your app. The app passes the token to the mobile SDK's `identifyUser()`.
 *
 * `token = base64url_nopad(HMAC_SHA256(secret, customerId . "." . issuedAt)) . "." . issuedAt`, the signer Clikgate
 * verifies with. No network call. Guide: https://clikgate.com/docs/identify-users
 *
 * Browser and mobile builds: PHP has no browser or mobile build, so there is nothing to refuse; the
 * identity secret stays wherever your PHP runs, which is your server.
 *
 * ```php
 * use Clikgate\IdentityToken;
 * return ['user' => $user, 'clikgateIdentityToken' => IdentityToken::create((string) $user->id)];
 * ```
 */
final class IdentityToken
{
    /** The single secret's environment variable. */
    public const SECRET_ENV = 'CLIKGATE_IDENTITY_SECRET';
    /** The per-app map's environment variable: a JSON object `{"app_…": "cgis_…"}`. */
    public const SECRETS_ENV = 'CLIKGATE_IDENTITY_SECRETS';

    private const MAX_CUSTOMER_ID = 255;

    private function __construct() {}

    /**
     * Create an identity token for the signed-in user. Reads `CLIKGATE_IDENTITY_SECRET`, or with `appId` that app's
     * secret from `CLIKGATE_IDENTITY_SECRETS` (a JSON object of app IDs to secrets). `secret` overrides both;
     * `issuedAt` (Unix seconds) defaults to now. No API key needed.
     *
     * @param array{appId?: ?string, secret?: ?string, issuedAt?: ?int} $options
     *
     * @throws ConfigurationException                         when no secret is set (`missing_identity_secret`) or the map is malformed
     * @throws \Clikgate\Exception\InvalidRequestException     for an empty, over-long or non-UTF-8 customer ID (`invalid_customer_id`)
     */
    public static function create(string $customerId, array $options = []): string
    {
        return self::createWith($customerId, $options, null, null);
    }

    /**
     * @internal the client's own secrets (options `identitySecret` / `identitySecrets`) come first
     *
     * @param array{appId?: ?string, secret?: ?string, issuedAt?: ?int} $options
     * @param array<string, string>|null                               $ownSecrets
     */
    public static function createWith(string $customerId, array $options, ?string $ownSecret, ?array $ownSecrets): string
    {
        $length = '' === $customerId ? 0 : preg_match_all('/./su', $customerId);
        if (false === $length || 0 === $length || $length > self::MAX_CUSTOMER_ID) {
            // Never echo the customer ID.
            throw ErrorMapper::local('invalid_customer_id', 'customerId must be your own user ID as a string of 1-255 characters (never an email or phone number).', 'customer_id');
        }
        $issuedAt = $options['issuedAt'] ?? time();
        if ($issuedAt < 0) {
            throw ErrorMapper::local('invalid_argument', 'issuedAt must be whole Unix seconds.', 'issued_at');
        }
        $secret = self::resolveSecret($options['secret'] ?? null, $options['appId'] ?? null, $ownSecret, $ownSecrets);

        return self::sign($secret, $customerId, $issuedAt);
    }

    /** @internal */
    public static function sign(string $secret, string $customerId, int $issuedAt): string
    {
        $mac = hash_hmac('sha256', $customerId . '.' . $issuedAt, $secret, true);

        return rtrim(strtr(base64_encode($mac), '+/', '-_'), '=') . '.' . $issuedAt;
    }

    /** @param array<string, string>|null $ownSecrets */
    private static function resolveSecret(?string $secret, ?string $appId, ?string $ownSecret, ?array $ownSecrets): string
    {
        if (null !== $secret && '' !== $secret) {
            return $secret;
        }
        $secrets = $ownSecrets ?? self::envMap();
        if (null !== $appId && null !== $secrets && isset($secrets[$appId]) && '' !== $secrets[$appId]) {
            return $secrets[$appId];
        }
        $env = getenv(self::SECRET_ENV);
        $single = null !== $ownSecret && '' !== $ownSecret ? $ownSecret : (\is_string($env) && '' !== $env ? $env : null);
        if (null !== $single) {
            return $single;
        }
        if (null === $appId && null !== $secrets && [] !== $secrets) {
            throw new ConfigurationException(\sprintf("Several apps' identity secrets are set (%s): pass 'appId' to choose one.", self::SECRETS_ENV), 'missing_identity_secret', param: 'appId');
        }
        $message = null === $appId
            ? \sprintf('No identity secret: set %s on your server (Apps > your app > Identity secret).', self::SECRET_ENV)
            : \sprintf('No identity secret for this app: add it to %s or set %s.', self::SECRETS_ENV, self::SECRET_ENV);

        throw new ConfigurationException($message, 'missing_identity_secret', param: 'secret');
    }

    /** @return array<string, string>|null */
    private static function envMap(): ?array
    {
        $raw = getenv(self::SECRETS_ENV);
        if (!\is_string($raw) || '' === trim($raw)) {
            return null;
        }
        $parsed = json_decode($raw, true);
        $ok = \is_array($parsed) && ([] === $parsed || !array_is_list($parsed));
        if ($ok) {
            foreach ($parsed as $k => $v) {
                if (!\is_string($k) || !\is_string($v) || '' === $v) {
                    $ok = false;
                    break;
                }
            }
        }
        if (!$ok) {
            // Never echo the value: it holds secrets.
            throw new ConfigurationException(\sprintf('%s must be a JSON object of app IDs to identity secrets, e.g. {"app_…": "cgis_…"}.', self::SECRETS_ENV), 'invalid_identity_secrets', param: self::SECRETS_ENV);
        }

        /** @var array<string, string> $parsed */
        return $parsed;
    }
}
