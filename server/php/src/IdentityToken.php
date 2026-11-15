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
 * verifies with. With `customerSince` the token is version 2 and also carries when the person became your
 * customer: `signature.issuedAt.customerSince`. No network call. Guide: https://clikgate.com/docs/identify-users
 *
 * Browser and mobile builds: PHP has no browser or mobile build, so there is nothing to refuse; the
 * identity secret stays wherever your PHP runs, which is your server.
 *
 * ```php
 * use Clikgate\IdentityToken;
 * return ['user' => $user, 'clikgateIdentityToken' => IdentityToken::create((string) $user->id)];
 * // With the account date (version 2):
 * IdentityToken::create((string) $user->id, ['customerSince' => $user->created_at]);
 * ```
 */
final class IdentityToken
{
    /** The single secret's environment variable. */
    public const SECRET_ENV = 'CLIKGATE_IDENTITY_SECRET';
    /** The per-app map's environment variable: a JSON object `{"app_…": "cgis_…"}`. */
    public const SECRETS_ENV = 'CLIKGATE_IDENTITY_SECRETS';

    private const MAX_CUSTOMER_ID = 255;
    /** 1990-01-01: earlier account dates are refused. */
    private const MIN_CUSTOMER_SINCE = 631152000;
    /** The clock allowance for an account date after issuedAt. */
    private const CLOCK_ALLOWANCE = 300;

    private function __construct() {}

    /**
     * Create an identity token for the signed-in user. Reads `CLIKGATE_IDENTITY_SECRET`, or with `appId` that app's
     * secret from `CLIKGATE_IDENTITY_SECRETS` (a JSON object of app IDs to secrets). `secret` overrides both;
     * `issuedAt` (Unix seconds) defaults to now. `customerSince` (when the person became your customer: a
     * `DateTimeInterface` or Unix seconds) makes a version 2 token, so Clikgate can tell an existing customer from a
     * new one. No API key needed.
     *
     * @param array{appId?: ?string, secret?: ?string, issuedAt?: ?int, customerSince?: \DateTimeInterface|int|null} $options
     *
     * @throws ConfigurationException                         when no secret is set (`missing_identity_secret`) or the map is malformed
     * @throws \Clikgate\Exception\InvalidRequestException     for an empty, over-long or non-UTF-8 customer ID (`invalid_customer_id`),
     *                                                         or an account date before 1990 or after issuedAt (`invalid_argument`, param `customer_since`)
     */
    public static function create(string $customerId, array $options = []): string
    {
        return self::createWith($customerId, $options, null, null);
    }

    /**
     * @internal the client's own secrets (options `identitySecret` / `identitySecrets`) come first
     *
     * @param array{appId?: ?string, secret?: ?string, issuedAt?: ?int, customerSince?: \DateTimeInterface|int|null} $options
     * @param array<string, string>|null                                                                          $ownSecrets
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
        $since = $options['customerSince'] ?? null;
        if (null === $since) {
            return self::sign(self::resolveSecret($options['secret'] ?? null, $options['appId'] ?? null, $ownSecret, $ownSecrets), $customerId, $issuedAt);
        }
        $since = self::seconds($since);
        if (null === $since || $since < self::MIN_CUSTOMER_SINCE || $since > $issuedAt + self::CLOCK_ALLOWANCE) {
            throw ErrorMapper::local('invalid_argument', 'customerSince must be between 1990 and the time the token is issued.', 'customer_since');
        }
        $cid = CustomerId::canonical($customerId);
        if ('' === $cid) {
            throw ErrorMapper::local('invalid_customer_id', 'customerId must be your own user ID as a string of 1-255 characters (never an email or phone number).', 'customer_id');
        }

        return self::signV2(self::resolveSecret($options['secret'] ?? null, $options['appId'] ?? null, $ownSecret, $ownSecrets), $cid, $issuedAt, $since);
    }

    private static function seconds(mixed $since): ?int
    {
        if ($since instanceof \DateTimeInterface) {
            return $since->getTimestamp();
        }

        return \is_int($since) ? $since : null;
    }

    /**
     * @internal Version 2: the MAC input is
     * `"v2\n" . strlen(cid) . ":" . cid . "\n" . issuedAt . "\n" . customerSince`, cid in canonical form
     */
    public static function signV2(string $secret, string $customerId, int $issuedAt, int $customerSince): string
    {
        $cid = CustomerId::canonical($customerId);
        $mac = hash_hmac('sha256', "v2\n" . \strlen($cid) . ':' . $cid . "\n" . $issuedAt . "\n" . $customerSince, $secret, true);

        return rtrim(strtr(base64_encode($mac), '+/', '-_'), '=') . '.' . $issuedAt . '.' . $customerSince;
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
