<?php

declare(strict_types=1);

namespace Clikgate\Tests\Unit;

use Clikgate\Clikgate;
use Clikgate\ErrorContext;
use Clikgate\Exception\ClikgateException;
use Clikgate\Exception\ConfigurationException;
use Clikgate\Exception\PrivateModeFieldRejectedException;
use Clikgate\Money;
use Clikgate\Psr15\ClikgateMiddleware;
use Clikgate\UserAgent;
use Clikgate\Webhooks;
use Nyholm\Psr7\Response;
use Nyholm\Psr7\ServerRequest;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;

final class ClientTest extends TestCase
{
    private const KEY = 'cg_test_unit000000000000';
    private const CID = 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6';
    private const UA = '/^clikgate-(node|python|php|java|dotnet)\/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?) \(([a-z]+) ([0-9][0-9A-Za-z.+-]{0,39}); ([^ ]+) ([^)]+)\)( .*)?$/';

    protected function setUp(): void
    {
        putenv('CLIKGATE_API_KEY');
        putenv('CLIKGATE_BASE_URL');
    }

    /**
     * @param array<string, mixed> $options
     */
    private function client(RecordingClient $http, array $options = []): Clikgate
    {
        return new Clikgate(['apiKey' => self::KEY, 'httpClient' => $http, 'shutdownHooks' => false] + $options);
    }

    public function testMoney(): void
    {
        self::assertSame('1500.50', Money::formatValue('1500.50'));
        self::assertSame('2000000', Money::formatValue(2_000_000));
        self::assertSame('9007199254740993', Money::formatValue(9007199254740993));
        $this->expectException(\InvalidArgumentException::class);
        Money::formatValue(1500.5);
    }

    public function testUserAgent(): void
    {
        self::assertSame('1.8.0-402', UserAgent::sanitise('1.8.0_402'));
        self::assertMatchesRegularExpression(self::UA, UserAgent::build());
        self::assertSame('clikgate-php/2.0.0 (php 8.1.0; windows x64)', UserAgent::build('Windows', 'AMD64', '8.1.0'));
        self::assertMatchesRegularExpression(self::UA, UserAgent::build('Linux', 'aarch64', '8.4.0-dev'));
    }

    public function testConfigurationErrors(): void
    {
        foreach ([[[], 'missing_api_key'], [['apiKey' => 'cg_sdk_secretvalue'], 'invalid_api_key'], [['apiKey' => self::KEY, 'retries' => 1], 'invalid_option'], [['apiKey' => self::KEY, 'baseUrl' => 'http://example.com'], 'invalid_option'], [['apiKey' => self::KEY, 'proxy' => 'socks5://x'], 'invalid_option']] as [$options, $code]) {
            try {
                new Clikgate($options);
                self::fail('expected a ConfigurationException');
            } catch (ConfigurationException $e) {
                self::assertSame($code, $e->getErrorCode());
                self::assertStringNotContainsString('secretvalue', $e->getMessage());
            }
        }
        self::assertSame('live', (new Clikgate(['apiKey' => 'cg_live_x', 'shutdownHooks' => false]))->mode);
    }

    public function testGuardNeverReachesTheTransport(): void
    {
        $http = new RecordingClient();
        $errors = [];
        $c = $this->client($http, ['privateMode' => true, 'onError' => static function (ClikgateException $e, ErrorContext $ctx) use (&$errors): void {
            $errors[] = [$e, $ctx];
        }]);
        try {
            $c->goals->send('account_opened', ['reference' => 'APP-1', 'metadata' => ['email' => 'secret@example.com']]);
            self::fail('expected a refusal');
        } catch (PrivateModeFieldRejectedException $e) {
            self::assertSame('metadata', $e->getField());
            self::assertStringNotContainsString('secret@example.com', $e->getMessage());
        }
        $c->goal('account_opened', ['reference' => 'APP-SECRET', 'metadata' => ['ads' => true]]);
        self::assertSame([], $http->requests);
        self::assertCount(1, $errors);
        self::assertSame([['goal' => 'account_opened', 'reference' => '[redacted]']], $errors[0][1]->events);
        $c->goal('account_opened', ['reference' => 'APP-OK']);
        self::assertSame([['goal' => 'account_opened', 'reference' => 'APP-OK']], $http->bodies());
        [$key] = $http->headers('Idempotency-Key');
        self::assertMatchesRegularExpression('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', $key);
        self::assertNotSame(hash('sha256', 'account_opened:APP-OK'), $key);
    }

    public function testGoalNeverThrows(): void
    {
        $http = new RecordingClient(static fn(): ResponseInterface => new Response(422, [], '{"error":{"type":"invalid_request","code":"invalid_value","message":"Bad.","param":"value"}}'));
        $codes = [];
        $c = $this->client($http, ['privateMode' => false, 'onError' => static function (ClikgateException $e) use (&$codes): void {
            $codes[] = $e->getErrorCode();
            throw new \RuntimeException('a broken callback is swallowed');
        }]);
        $c->goal('Bad-Key', ['reference' => 'R-1']);
        $c->goal('order_paid', ['reference' => 'R-1', 'value' => 1.5]);
        $c->goal('order_paid', ['reference' => 'R-1', 'nope' => true]);
        $c->goal('order_paid', ['reference' => 'R-1', 'value' => '1.005']);
        self::assertSame(['invalid_goal_key', 'invalid_value', 'invalid_argument', 'invalid_value'], $codes);
        self::assertCount(1, $http->requests);
        $req = $http->requests[0];
        self::assertSame('Bearer ' . self::KEY, $req->getHeaderLine('Authorization'));
        self::assertMatchesRegularExpression(self::UA, $req->getHeaderLine('User-Agent'));
    }

    public function testAfterResponseSendsAtShutdown(): void
    {
        $http = new RecordingClient(static fn(): ResponseInterface => new Response(200, [], '{"object":"list","data":[]}'));
        $c = $this->client($http, ['privateMode' => false, 'sendMode' => 'after_response']);
        $c->goal('order_paid', ['reference' => 'R-1']);
        $c->goal('order_paid', ['reference' => 'R-2']);
        self::assertSame([], $http->requests);
        $c->onShutdown();
        self::assertSame([['events' => [['goal' => 'order_paid', 'reference' => 'R-1'], ['goal' => 'order_paid', 'reference' => 'R-2']]]], $http->bodies());
    }

    public function testBackgroundSendsPerBatchSize(): void
    {
        $http = new RecordingClient(static fn(): ResponseInterface => new Response(200, [], '{"object":"list","data":[]}'));
        $c = $this->client($http, ['privateMode' => false, 'sendMode' => 'background', 'batchSize' => 2]);
        foreach (range(1, 5) as $i) {
            $c->goal('order_paid', ['reference' => "R-{$i}"]);
        }
        self::assertCount(2, $http->requests);
        self::assertTrue($c->close());
        self::assertSame([2, 2, 1], array_map(static fn(array $b): int => \count(\is_array($b['events']) ? $b['events'] : []), $http->bodies()));
    }

    public function testApiLayerUsesThePipeline(): void
    {
        $http = new RecordingClient(static fn(): ResponseInterface => new Response(200, [], '{"object":"link","id":"lnk_1"}'));
        $c = $this->client($http);
        $link = $c->api->links->fetchLink('lnk_a/b');
        self::assertSame(['object' => 'link', 'id' => 'lnk_1'], $link);
        self::assertSame('/v1/links/lnk_a%2Fb', $http->requests[0]->getUri()->getPath());
        self::assertFalse($http->requests[0]->hasHeader('Idempotency-Key'));
    }

    public function testPsr15MiddlewareAndPsr7Persist(): void
    {
        $handler = new class implements RequestHandlerInterface {
            public mixed $seen = null;

            public function handle(ServerRequestInterface $request): ResponseInterface
            {
                $this->seen = $request->getAttribute(ClikgateMiddleware::ATTRIBUTE);

                return (new Response(200))->withAddedHeader('Set-Cookie', 'session=abc; Path=/');
            }
        };
        $mw = new ClikgateMiddleware();
        $res = $mw->process(new ServerRequest('GET', 'https://shop.example/landing?cgid=' . self::CID), $handler);
        self::assertSame(self::CID, $handler->seen);
        self::assertSame(['session=abc; Path=/', '_cg_cgid=' . self::CID . '; Path=/; Max-Age=2592000; SameSite=Lax; Secure', '_cg_kept=s; Path=/; Max-Age=2592000; SameSite=Lax; Secure'], $res->getHeader('Set-Cookie'));
        $res = $mw->process((new ServerRequest('GET', 'http://localhost/'))->withHeader('Cookie', '_cg_cgid=' . self::CID), $handler);
        self::assertSame(self::CID, $handler->seen);
        self::assertSame(['session=abc; Path=/'], $res->getHeader('Set-Cookie'));
    }

    public function testWebhooksWithoutAClient(): void
    {
        $body = '{"id":"evt_1","object":"event","type":"goal.completed","data":{"object":{}}}';
        $t = 1_793_016_000;
        $sig = hash_hmac('sha256', "{$t}.{$body}", 'whsec_x');
        self::assertSame('evt_1', Webhooks::verify($body, "t={$t},v1={$sig}", 'whsec_x', 300, $t)['id']);
    }

    public function testMetadataFilterAndEndGoalValue(): void
    {
        $page = '{"object":"list","data":[{"group":"sel_ada","end_goal_value":{"NGN":"18500.00"},"end_goal_value_minor":{"NGN":1850000}}],"has_more":false,"next_cursor":null}';
        $http = new RecordingClient(static fn(): ResponseInterface => new Response(200, [], $page));
        $c = $this->client($http, ['privateMode' => false]);
        $res = $c->api->analytics->analyticsSummary(groupBy: 'metadata.product_id', metadata: ['seller_id' => 'sel_ada']);
        self::assertSame('group_by=metadata.product_id&metadata%5Bseller_id%5D=sel_ada', $http->requests[0]->getUri()->getQuery());
        // end_goal_value is decimal strings per currency, next to end_goal_value_minor (X.E10).
        self::assertIsArray($res);
        self::assertIsArray($res['data']);
        $row = $res['data'][0];
        self::assertIsArray($row);
        self::assertSame(['NGN' => '18500.00'], $row['end_goal_value']);
        $c->api->links->listLinks(metadata: ['seller_id' => 'sel ada']);
        self::assertSame('metadata%5Bseller_id%5D=sel%20ada', $http->requests[1]->getUri()->getQuery());
    }
}
