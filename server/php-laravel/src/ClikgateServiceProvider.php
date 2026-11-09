<?php

declare(strict_types=1);

namespace Clikgate\Laravel;

use Clikgate\ClickIds;
use Clikgate\Clikgate as Client;
use Clikgate\Laravel\Http\Controllers\KeepClickId;
use Clikgate\Laravel\Http\Middleware\CaptureClickId;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Http\Request;
use Illuminate\Routing\Router;
use Illuminate\Support\ServiceProvider;

/**
 * Auto-discovered. Registers the client (a singleton), the `clikgate` middleware alias, the `Clikgate` facade
 * the `$request->clikgateClickId()` macro and the `Route::clikgateKeep('/cg/keep')` route macro.
 */
final class ClikgateServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__ . '/../config/clikgate.php', 'clikgate');
        $this->app->singleton(Client::class, fn(Application $app): Client => new Client(self::clientOptions($this->config(), $app->bound('log') ? $app->make('log') : null)));
        $this->app->singleton(ClikgateManager::class, static fn(Application $app): ClikgateManager => new ClikgateManager($app));
        $this->app->alias(ClikgateManager::class, 'clikgate');
    }

    public function boot(): void
    {
        $this->publishes([__DIR__ . '/../config/clikgate.php' => $this->app->configPath('clikgate.php')], 'clikgate-config');
        $router = $this->app->make(Router::class);
        $router->aliasMiddleware('clikgate', CaptureClickId::class);
        // The web script reads the click-ID cookie, so Laravel must not encrypt it
        $param = $this->config()['click_id_param'] ?? null;
        EncryptCookies::except(array_values(array_unique(['_cg_cgid', '_cg_' . (\is_string($param) && '' !== $param ? $param : 'cgid'), ClickIds::MARKER])));
        // Route::clikgateKeep('/cg/keep'): the /cg/keep route for the web script's data-server-endpoint (SPEC 13.1).
        // Every method reaches the handler (it answers 405 itself, with Cache-Control); CSRF is skipped for this
        // route only, because the handler checks Sec-Fetch-Site / Origin and accepts nothing but a click ID.
        Router::macro('clikgateKeep', function (string $uri = '/cg/keep'): \Illuminate\Routing\Route {
            /** @var Router $this */
            return $this->any($uri, KeepClickId::class)->withoutMiddleware([
                'Illuminate\\Foundation\\Http\\Middleware\\ValidateCsrfToken',
                'Illuminate\\Foundation\\Http\\Middleware\\VerifyCsrfToken',
                'App\\Http\\Middleware\\VerifyCsrfToken',
            ]);
        });
        Request::macro('clikgateClickId', function (): ?string {
            /** @var Request $this */
            $value = $this->attributes->get(CaptureClickId::ATTRIBUTE);
            if (\is_string($value)) {
                return $value;
            }

            return app(Client::class)->clickIds->fromRequest($this);
        });
    }

    /** @return array<string, mixed> */
    private function config(): array
    {
        $repository = $this->app->make('config');
        $c = $repository instanceof \Illuminate\Contracts\Config\Repository ? $repository->get('clikgate', []) : [];

        /** @var array<string, mixed> */
        return \is_array($c) ? $c : [];
    }

    /**
     * @param array<string, mixed> $c
     *
     * @return array<string, mixed>
     */
    public static function clientOptions(array $c, mixed $logger = null): array
    {
        $privateMode = $c['private_mode'] ?? 'auto';
        if (\is_string($privateMode) && 'auto' !== $privateMode) {
            $privateMode = filter_var($privateMode, \FILTER_VALIDATE_BOOL);
        }
        $options = array_filter([
            'apiKey' => $c['api_key'] ?? null,
            'baseUrl' => $c['base_url'] ?? null,
            'sendMode' => $c['send_mode'] ?? null,
            'privateMode' => $privateMode,
            'timeout' => $c['timeout'] ?? null,
            'maxRetries' => $c['max_retries'] ?? null,
            'proxy' => $c['proxy'] ?? null,
            'clickIdParam' => $c['click_id_param'] ?? null,
            'identitySecret' => \is_string($c['identity_secret'] ?? null) ? $c['identity_secret'] : null,
            'identitySecrets' => self::identitySecrets($c['identity_secrets'] ?? null),
        ], static fn(mixed $v): bool => null !== $v && '' !== $v);
        if ($logger instanceof \Psr\Log\LoggerInterface) {
            $options['logger'] = $logger;
        }

        return $options;
    }

    /**
     * `clikgate.identity_secrets` as app ID => secret: an array, or the JSON text of `CLIKGATE_IDENTITY_SECRETS`.
     * Null when unset or malformed (then {@see ClikgateManager::createIdentityToken()} reports it; the rest of the
     * client keeps working).
     *
     * @return array<string, string>|null
     */
    public static function identitySecrets(mixed $value): ?array
    {
        if (\is_string($value)) {
            if ('' === trim($value)) {
                return null;
            }
            $value = json_decode($value, true);
        }
        if (!\is_array($value) || [] === $value || array_is_list($value)) {
            return null;
        }
        $out = [];
        foreach ($value as $k => $v) {
            if (!\is_string($k) || !\is_string($v) || '' === $v) {
                return null;
            }
            $out[$k] = $v;
        }

        return $out;
    }
}
