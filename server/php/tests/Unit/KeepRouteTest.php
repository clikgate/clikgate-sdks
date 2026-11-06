<?php

declare(strict_types=1);

namespace Clikgate\Tests\Unit;

use Clikgate\ClickIds;
use Clikgate\Clikgate;
use Clikgate\Exception\InvalidRequestException;
use Clikgate\Exception\PrivateModeFieldRejectedException;
use Clikgate\Goals;
use Nyholm\Psr7\Factory\Psr17Factory;
use Nyholm\Psr7\Response;
use Nyholm\Psr7\ServerRequest;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;

/** Change 16: the `/cg/keep` route, the `_cg_kept=s` marker and `clickIds->context()` (SPEC 13, 13.1). */
final class KeepRouteTest extends TestCase
{
    private const CID = 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6';
    private const COOKIE = '_cg_cgid=' . self::CID . '; Path=/; Max-Age=2592000; SameSite=Lax; Secure';
    private const MARKER = '_cg_kept=s; Path=/; Max-Age=2592000; SameSite=Lax; Secure';

    /**
     * @param array<string, string> $headers
     * @param array<string, mixed>  $options
     */
    private function keep(array $headers, string $body, string $method = 'POST', array $options = [], ?ClickIds $ids = null): ResponseInterface
    {
        $request = new ServerRequest($method, 'https://shop.example.com/cg/keep', $headers + ['Host' => 'shop.example.com'], $body);

        return ($ids ?? new ClickIds())->keepRoute($options, new Psr17Factory())->handle($request);
    }

    private static function body(string $id, ?string $page = null): string
    {
        return json_encode(['click_id' => $id, 'page_click_id' => $page ?? $id], \JSON_THROW_ON_ERROR);
    }

    private static function assertEmptyNoStore(ResponseInterface $r): void
    {
        self::assertSame('no-store, private', $r->getHeaderLine('Cache-Control'));
        self::assertSame('', (string) $r->getBody());
        self::assertFalse($r->hasHeader('Location'));
    }

    public function testSameOriginSetsTheCookieAndTheMarker(): void
    {
        $r = $this->keep(['Sec-Fetch-Site' => 'same-origin'], self::body(self::CID));
        self::assertSame(204, $r->getStatusCode());
        self::assertSame([self::COOKIE, self::MARKER], $r->getHeader('Set-Cookie'));
        foreach ($r->getHeader('Set-Cookie') as $c) {
            self::assertStringNotContainsStringIgnoringCase('HttpOnly', $c);
        }
        self::assertEmptyNoStore($r);
    }

    public function testOriginMustMatchTheHostIncludingThePort(): void
    {
        self::assertSame(204, $this->keep(['Origin' => 'https://SHOP.example.com'], self::body(self::CID))->getStatusCode());
        self::assertSame(204, $this->keep(['Origin' => 'https://shop.example.com', 'X-Forwarded-Host' => 'shop.example.com, internal.local', 'Host' => 'internal.local'], self::body(self::CID))->getStatusCode());
        foreach (['https://shop.example.com:8443', 'https://evil.example.net', 'null'] as $origin) {
            $r = $this->keep(['Origin' => $origin], self::body(self::CID));
            self::assertSame(403, $r->getStatusCode(), $origin);
            self::assertSame([], $r->getHeader('Set-Cookie'));
            self::assertEmptyNoStore($r);
        }
        self::assertSame(403, $this->keep([], self::body(self::CID))->getStatusCode());
        self::assertSame(403, $this->keep(['Sec-Fetch-Site' => 'cross-site', 'Origin' => 'https://shop.example.com'], self::body(self::CID))->getStatusCode());
        self::assertSame(403, $this->keep(['Sec-Fetch-Site' => 'same-site'], self::body(self::CID))->getStatusCode());
    }

    public function testOnlyPost(): void
    {
        $r = $this->keep(['Sec-Fetch-Site' => 'same-origin'], '', 'GET');
        self::assertSame(405, $r->getStatusCode());
        self::assertSame('POST', $r->getHeaderLine('Allow'));
        self::assertEmptyNoStore($r);
    }

    public function testBadBodiesAre400AndNeverEchoed(): void
    {
        $bodies = ['<script>x</script>', '[]', '"' . self::CID . '"', self::body('<b>' . self::CID . '</b>'), self::body(self::CID, 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W7'), self::body(strtolower(self::CID)), '{"click_id":"' . self::CID . '"}', self::body(self::CID) . str_repeat(' ', 1024)];
        foreach ($bodies as $body) {
            $r = $this->keep(['Sec-Fetch-Site' => 'same-origin'], $body);
            self::assertSame(400, $r->getStatusCode(), $body);
            self::assertSame([], $r->getHeader('Set-Cookie'));
            self::assertEmptyNoStore($r);
        }
    }

    public function testNameFromConfigurationAndOptions(): void
    {
        $client = new Clikgate(['apiKey' => 'cg_test_unit000000000000', 'clickIdParam' => 'ref', 'shutdownHooks' => false, 'httpClient' => new RecordingClient()]);
        $body = json_encode(['click_id' => self::CID, 'page_click_id' => self::CID, 'name' => 'session', 'param' => 'evil'], \JSON_THROW_ON_ERROR);
        $r = $this->keep(['Sec-Fetch-Site' => 'same-origin'], $body, 'POST', ['days' => 90, 'secure' => false, 'domain' => '.example.com'], $client->clickIds);
        self::assertSame([
            '_cg_ref=' . self::CID . '; Path=/; Max-Age=7776000; Domain=.example.com; SameSite=Lax',
            '_cg_kept=s; Path=/; Max-Age=7776000; Domain=.example.com; SameSite=Lax',
        ], $r->getHeader('Set-Cookie'));
    }

    public function testDaysMustBe1To400(): void
    {
        foreach ([0, 401, -1] as $days) {
            try {
                (new ClickIds())->keepRoute(['days' => $days]);
                self::fail('no exception');
            } catch (InvalidRequestException $e) {
                self::assertSame('invalid_argument', $e->getErrorCode());
            }
        }
        self::assertInstanceOf(\Clikgate\Psr15\KeepRouteHandler::class, (new ClickIds())->keepRoute(['days' => 400]));
    }

    public function testPersistAddsTheMarker(): void
    {
        $r = (new ClickIds())->persist(new Response(), self::CID, ['secure' => true]);
        self::assertInstanceOf(ResponseInterface::class, $r);
        self::assertSame([self::COOKIE, self::MARKER], $r->getHeader('Set-Cookie'));
    }

    public function testContext(): void
    {
        $ids = new ClickIds();
        $iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0 Mobile/15E148 Safari/604.1';
        self::assertSame(['clickId' => self::CID, 'keptBy' => 'server_cookie', 'browserEngine' => 'webkit_ios', 'platform' => 'ios'], $ids->context(['url' => '/', 'headers' => ['Cookie' => '_cg_cgid=' . self::CID . '; _cg_kept=s', 'User-Agent' => $iphone]]));
        self::assertSame('script_cookie', $ids->context(['url' => '/', 'headers' => ['cookie' => '_cg_cgid=' . self::CID . '; _cg_kept=x']])['keptBy']);
        self::assertSame('form', $ids->context(['url' => '/', 'headers' => ['Clikgate-Click-Id' => self::CID]])['keptBy']);
        $fromUrl = $ids->context(new ServerRequest('GET', 'https://shop.example.com/?cgid=' . self::CID));
        self::assertSame([self::CID, null, 'other', 'other'], [$fromUrl['clickId'], $fromUrl['keptBy'], $fromUrl['browserEngine'], $fromUrl['platform']]);
        self::assertSame('safari_mac', ClickIds::browserEngine('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'));
        self::assertSame('gecko', ClickIds::browserEngine('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0'));
        self::assertSame('linux', ClickIds::platform('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0'));
        self::assertSame('chromium', ClickIds::browserEngine('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'));
    }

    public function testGoalContextOptions(): void
    {
        $wire = Goals::wire('account_opened', ['reference' => 'R-1', 'clickId' => self::CID, 'keptBy' => 'server_cookie', 'browserEngine' => 'webkit_ios', 'platform' => 'ios']);
        self::assertSame(['server_cookie', 'webkit_ios', 'ios'], [$wire['kept_by'], $wire['browser_engine'], $wire['platform']]);
        $this->expectException(InvalidRequestException::class);
        Goals::wire('account_opened', ['reference' => 'R-1', 'keptBy' => 'localstorage']);
    }

    public function testGuardAllowsTheContext(): void
    {
        $http = new RecordingClient();
        $client = new Clikgate(['apiKey' => 'cg_test_unit000000000000', 'privateMode' => true, 'shutdownHooks' => false, 'httpClient' => $http]);
        $client->goals->send('account_opened', ['reference' => 'R-1', 'keptBy' => 'script_cookie', 'browserEngine' => 'chromium', 'platform' => 'android']);
        self::assertCount(1, $http->requests);
        $sent = json_decode((string) $http->requests[0]->getBody(), true, 512, \JSON_THROW_ON_ERROR);
        self::assertIsArray($sent);
        self::assertSame(['script_cookie', 'chromium', 'android'], [$sent['kept_by'], $sent['browser_engine'], $sent['platform']]);
        try {
            $client->goals->send('account_opened', ['reference' => 'R-2', 'keptBy' => 'script_cookie', 'metadata' => ['x' => 1]]);
            self::fail('no exception');
        } catch (PrivateModeFieldRejectedException $e) {
            self::assertSame('metadata', $e->getField());
        }
        self::assertCount(1, $http->requests);
    }
}
