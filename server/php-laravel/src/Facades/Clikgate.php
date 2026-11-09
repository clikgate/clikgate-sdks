<?php

declare(strict_types=1);

namespace Clikgate\Laravel\Facades;

use Illuminate\Support\Facades\Facade;

/**
 * @method static void goal(string $key, array<string, mixed> $options)
 * @method static \Clikgate\Goals goals()
 * @method static \Clikgate\Links links()
 * @method static \Clikgate\Conversions conversions()
 * @method static \Clikgate\Payments payments()
 * @method static \Clikgate\Clicks clicks()
 * @method static \Clikgate\ClickIds clickIds()
 * @method static \Clikgate\Generated\ApiClient api()
 * @method static array<string, mixed>|null config()
 * @method static bool flush(float $timeout = 10.0)
 * @method static array<string, mixed> verifyWebhook(string $rawBody, ?string $signatureHeader, string $secret, int $tolerance = 300)
 * @method static string createIdentityToken(string $customerId, array{appId?: ?string, issuedAt?: ?int} $options = [])
 * @method static array<string, mixed> identifyUser(array<string, mixed> $params, array<string, mixed> $requestOptions = [])
 * @method static \Clikgate\Clikgate client()
 *
 * @see \Clikgate\Laravel\ClikgateManager
 */
final class Clikgate extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return 'clikgate';
    }
}
