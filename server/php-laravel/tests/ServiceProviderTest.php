<?php

declare(strict_types=1);

namespace Clikgate\Laravel\Tests;

use Clikgate\Clikgate as Client;
use Clikgate\Laravel\ClikgateServiceProvider;
use Clikgate\Laravel\Facades\Clikgate;
use Clikgate\Laravel\Jobs\SendGoal;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Route;
use Orchestra\Testbench\TestCase;

final class ServiceProviderTest extends TestCase
{
    private const CID = 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6';

    protected function getPackageProviders($app): array
    {
        return [ClikgateServiceProvider::class];
    }

    protected function getPackageAliases($app): array
    {
        return ['Clikgate' => Clikgate::class];
    }

    protected function defineEnvironment($app): void
    {
        $app['config']->set('clikgate.api_key', 'cg_test_laravel000');
        $app['config']->set('clikgate.private_mode', 'false');
        $app['config']->set('app.key', 'base64:' . base64_encode(str_repeat('k', 32)));
    }

    protected function defineRoutes($router): void
    {
        Route::middleware('clikgate')->get('/landing', static fn(Request $request): string => (string) $request->clikgateClickId());
        Route::clikgateKeep('/cg/keep');
        Route::middleware('web')->group(static function (): void {
            Route::clikgateKeep('/web/cg/keep');
        });
    }

    public function testClientIsASingletonConfiguredFromConfig(): void
    {
        $client = $this->app->make(Client::class);
        self::assertSame($client, $this->app->make(Client::class));
        self::assertSame('test', $client->mode);
        self::assertSame($client, Clikgate::client());
    }

    public function testMiddlewareCapturesAndPersists(): void
    {
        $response = $this->get('https://localhost/landing?cgid=' . self::CID);
        $response->assertOk();
        self::assertSame(self::CID, $response->getContent());
        // Symfony re-renders Set-Cookie (adds expires, lowercases attributes): check the attributes
        $cookie = strtolower(implode("\n", $response->headers->all('set-cookie')));
        self::assertStringContainsString(strtolower('_cg_cgid=' . self::CID), $cookie);
        foreach (['max-age=2592000', 'path=/', 'samesite=lax', 'secure'] as $attribute) {
            self::assertStringContainsString($attribute, $cookie);
        }
        self::assertStringNotContainsString('httponly', $cookie);

        $again = $this->get('/landing', ['Cookie' => '_cg_cgid=' . self::CID]);
        self::assertSame(self::CID, $again->getContent());
    }

    public function testTheCookieIsNotEncrypted(): void
    {
        $middleware = $this->app->make(\Illuminate\Cookie\Middleware\EncryptCookies::class);
        self::assertTrue($middleware->isDisabled('_cg_cgid'));
        self::assertTrue($middleware->isDisabled('_cg_kept'));
    }

    /** @param array<string, string> $server */
    private function keep(string $uri, array $server, string $body, string $method = 'POST'): \Illuminate\Testing\TestResponse
    {
        return $this->call($method, 'https://localhost' . $uri, [], [], [], $server + ['HTTP_HOST' => 'localhost', 'CONTENT_TYPE' => 'application/json'], $body);
    }

    public function testKeepRouteSetsTheCookieAndTheMarker(): void
    {
        $body = json_encode(['click_id' => self::CID, 'page_click_id' => self::CID], \JSON_THROW_ON_ERROR);
        foreach (['/cg/keep', '/web/cg/keep'] as $uri) { // the web group: CSRF is skipped and the cookies stay readable
            $response = $this->keep($uri, ['HTTP_SEC_FETCH_SITE' => 'same-origin'], $body);
            self::assertSame(204, $response->getStatusCode(), $uri);
            self::assertSame('', $response->getContent());
            self::assertFalse($response->headers->has('Location'));
            self::assertSame('no-store, private', $response->headers->get('Cache-Control'));
            $cookies = [];
            foreach ($response->headers->getCookies() as $c) {
                $cookies[$c->getName()] = $c;
            }
            self::assertSame(self::CID, $cookies['_cg_cgid']->getValue());
            self::assertSame('s', $cookies['_cg_kept']->getValue());
            foreach ([$cookies['_cg_cgid'], $cookies['_cg_kept']] as $c) {
                self::assertTrue($c->isSecure());
                self::assertFalse($c->isHttpOnly());
                self::assertSame('lax', $c->getSameSite());
                self::assertSame(2592000, $c->getMaxAge());
            }
        }
    }

    public function testKeepRouteRefusesOtherOriginsMethodsAndBodies(): void
    {
        $good = json_encode(['click_id' => self::CID, 'page_click_id' => self::CID], \JSON_THROW_ON_ERROR);
        $cases = [
            [403, ['HTTP_ORIGIN' => 'https://evil.example.net'], $good, 'POST'],
            [403, ['HTTP_SEC_FETCH_SITE' => 'cross-site'], $good, 'POST'],
            [403, [], $good, 'POST'],
            [400, ['HTTP_SEC_FETCH_SITE' => 'same-origin'], '{"click_id":"<script>alert(1)</script>","page_click_id":"<script>alert(1)</script>"}', 'POST'],
            [405, ['HTTP_SEC_FETCH_SITE' => 'same-origin'], '', 'GET'],
        ];
        foreach ($cases as [$status, $server, $body, $method]) {
            $response = $this->keep('/cg/keep', $server, $body, $method);
            self::assertSame($status, $response->getStatusCode());
            self::assertSame('', $response->getContent());
            self::assertSame([], $response->headers->getCookies());
            self::assertSame('no-store, private', $response->headers->get('Cache-Control'));
        }
        self::assertSame('POST', $this->keep('/cg/keep', [], '', 'GET')->headers->get('Allow'));
        self::assertSame(204, $this->keep('/cg/keep', ['HTTP_ORIGIN' => 'https://localhost'], $good)->getStatusCode());
    }

    public function testPaymentsAreReachableThroughTheFacade(): void
    {
        self::assertSame(Clikgate::client()->payments, Clikgate::payments());
        $body = Clikgate::payments()->buildFromPaystack(['data' => ['reference' => 'T_1', 'status' => 'success', 'amount' => 750000, 'currency' => 'NGN']]);
        self::assertSame(['provider' => 'paystack', 'reference' => 'T_1', 'status' => 'success', 'amount' => '7500', 'currency' => 'NGN'], $body);
    }

    public function testQueuedSending(): void
    {
        Queue::fake();
        $this->app['config']->set('clikgate.queue', 'redis');
        Clikgate::goal('account_opened', ['reference' => 'APP-1', 'value' => '2000000']);
        Queue::assertPushed(SendGoal::class, static fn(SendGoal $job): bool => 'account_opened' === $job->key && 'APP-1' === $job->options['reference'] && 'redis' === $job->connection);
    }

    public function testQueuedGoalRefusedAsUnknownEndsWithoutFailing(): void
    {
        $answers = [
            [422, '{"error":{"type":"invalid_request","code":"unknown_goal","message":"Not set up.","param":"goal"},"status":"refused","reason":"unknown_goal","counted":false,"goal_kind":null}'],
            [422, '{"status":"refused","reason":"goal_archived"}'],
            [422, '{"error":{"type":"invalid_request","code":"value_required","message":"Needs a value.","param":"value"}}'],
        ];
        $calls = 0;
        $http = new class ($answers, $calls) implements \Psr\Http\Client\ClientInterface {
            /** @param list<array{int, string}> $answers */
            public function __construct(private array $answers, private int &$calls) {}

            public function sendRequest(\Psr\Http\Message\RequestInterface $request): \Psr\Http\Message\ResponseInterface
            {
                ++$this->calls;
                [$status, $body] = array_shift($this->answers) ?? [500, '{}'];

                return new \GuzzleHttp\Psr7\Response($status, ['Content-Type' => 'application/json'], $body);
            }
        };
        $client = new Client(['apiKey' => 'cg_test_laravel000', 'httpClient' => $http, 'shutdownHooks' => false, 'privateMode' => false]);

        foreach (['level_complete', 'old_signup'] as $goal) {
            $job = (new SendGoal($goal, ['reference' => 'APP-1']))->withFakeQueueInteractions();
            $job->handle($client);
            $job->assertNotFailed();
        }
        $job = (new SendGoal('order_paid', ['reference' => 'APP-2']))->withFakeQueueInteractions();
        $job->handle($client);
        $job->assertFailed();
        self::assertSame(3, $calls);
    }

    public function testCreateIdentityTokenThroughTheFacade(): void
    {
        $json = file_get_contents(__DIR__ . '/../../conformance/vectors/identity-token-vectors.json');
        self::assertIsString($json);
        $doc = json_decode($json, true, 512, \JSON_THROW_ON_ERROR);
        self::assertIsArray($doc);
        self::assertIsArray($doc['vectors']);
        $byName = [];
        foreach ($doc['vectors'] as $v) {
            self::assertIsArray($v);
            self::assertIsString($v['name']);
            $byName[$v['name']] = $v;
        }
        $a = $byName['ascii'];
        $other = $byName['other_app_secret'];
        self::assertIsString($a['secret']);
        self::assertIsString($a['token']);
        self::assertIsInt($a['issued_at']);
        self::assertIsString($other['secret']);
        self::assertIsString($other['token']);
        self::assertIsInt($other['issued_at']);
        $this->app['config']->set('clikgate.identity_secret', $a['secret']);
        $this->app['config']->set('clikgate.identity_secrets', json_encode(['app_rider' => $other['secret']]));
        $this->app->forgetInstance(Client::class);
        self::assertSame($a['token'], Clikgate::createIdentityToken('user_42', ['issuedAt' => $a['issued_at']]));
        self::assertSame($other['token'], Clikgate::createIdentityToken('user_42', ['appId' => 'app_rider', 'issuedAt' => $other['issued_at']]));
    }

    public function testMalformedIdentitySecretsFailOnlyWhenTokensAreCreated(): void
    {
        $this->app['config']->set('clikgate.identity_secrets', '{not json');
        $this->app->forgetInstance(Client::class);
        self::assertSame('test', Clikgate::client()->mode);
        try {
            Clikgate::createIdentityToken('user_42', ['appId' => 'app_rider']);
            self::fail('expected ConfigurationException');
        } catch (\Clikgate\Exception\ConfigurationException $e) {
            self::assertSame('invalid_identity_secrets', $e->getErrorCode());
            self::assertStringNotContainsString('not json', $e->getMessage());
        }
    }
}
