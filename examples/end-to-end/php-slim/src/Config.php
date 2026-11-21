<?php

declare(strict_types=1);

namespace App;

/** Settings, read only from the environment (see .env.example). */
final class Config
{
    public function __construct(
        public readonly string $apiKey,
        /** Only set for a local fake of the API (the tests use one); the SDK defaults to the real API. */
        public readonly string $baseUrl,
        /** Optional: without it, responses carry no identity token and the app uses the installation header. */
        public readonly ?string $identitySecret,
        public readonly string $webhookSecret,
        /** One referral program ID in your configuration, never one per user. */
        public readonly string $referralProgramId,
    ) {}

    public static function fromEnvironment(): self
    {
        return new self(
            apiKey: self::required('CLIKGATE_API_KEY'),
            baseUrl: getenv('CLIKGATE_BASE_URL') ?: 'https://api.clikgate.com',
            identitySecret: getenv('CLIKGATE_IDENTITY_SECRET') ?: null,
            webhookSecret: self::required('CLIKGATE_WEBHOOK_SECRET'),
            referralProgramId: self::required('CLIKGATE_REFERRAL_PROGRAM_ID'),
        );
    }

    private static function required(string $name): string
    {
        $value = getenv($name);
        if (!\is_string($value) || '' === $value) {
            throw new \RuntimeException("{$name} is not set (see .env.example)");
        }

        return $value;
    }
}
