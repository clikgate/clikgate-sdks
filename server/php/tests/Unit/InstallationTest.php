<?php

declare(strict_types=1);

namespace Clikgate\Tests\Unit;

use Clikgate\Clikgate;
use Clikgate\Exception\ConflictException;
use Clikgate\Exception\InvalidRequestException;
use Clikgate\Installation;
use Clikgate\Psr15\ClikgateMiddleware;
use Nyholm\Psr7\Response;
use Nyholm\Psr7\ServerRequest;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;

/** The Clikgate-Installation header: the parser, identifyUser(['installation' => …]) and the PSR-15 attribute. */
final class InstallationTest extends TestCase
{
    private const KEY = 'cg_test_unit000000000000';
    private const APP = 'app_01JCK8Z9V7Q4M2N6P8R0S2T4AP';
    private const INST = '6a1f0c2e-0000-4000-8000-000000000001';
    private const HEADER = self::APP . ':' . self::INST;

    /** @return iterable<string, array{mixed}> */
    public static function badValues(): iterable
    {
        yield 'uppercase uuid' => [self::APP . ':' . strtoupper(self::INST)];
        yield 'lowercase app id' => [strtolower(self::APP) . ':' . self::INST];
        yield 'two colons' => [self::HEADER . ':x'];
        yield 'double colon' => [self::APP . '::' . self::INST];
        yield 'no colon' => [self::APP . self::INST];
        yield 'no installation' => [self::APP . ':'];
        yield 'no app' => [':' . self::INST];
        yield 'other prefix' => ['cli_01JCK8Z9V7Q4M2N6P8R0S2T4AP:' . self::INST];
        yield 'over 128 before trimming' => [str_repeat(' ', 70) . self::HEADER];
        yield 'two lines' => [self::HEADER . "\n" . self::HEADER];
        yield 'joined' => [self::HEADER . ', ' . self::HEADER];
        yield 'empty' => [''];
        yield 'spaces' => ['   '];
        yield 'huge' => [str_repeat('x', 10_000)];
        yield 'null' => [null];
        yield 'int' => [42];
        yield 'array' => [[self::HEADER]];
    }

    #[DataProvider('badValues')]
    public function testParseRefusesAnythingElse(mixed $bad): void
    {
        self::assertNull(Installation::parseHeader($bad));
    }

    public function testParseAcceptsTheContractTrimmed(): void
    {
        foreach ([self::HEADER, "\t" . self::HEADER . '  '] as $value) {
            $i = Installation::parseHeader($value);
            self::assertNotNull($i);
            self::assertSame([self::APP, self::INST], [$i->appId, $i->installationId]);
            self::assertSame(['appId' => self::APP, 'installationId' => self::INST], $i->toArray());
        }
        self::assertSame('Clikgate-Installation', Installation::HEADER);
    }

    public function testFromRequestShapes(): void
    {
        self::assertSame(self::INST, Installation::fromRequest((new ServerRequest('GET', '/me'))->withHeader('Clikgate-Installation', self::HEADER))?->installationId);
        self::assertNull(Installation::fromRequest((new ServerRequest('GET', '/me'))->withHeader('Clikgate-Installation', [self::HEADER, self::HEADER])));
        self::assertSame(self::APP, Installation::fromRequest(['headers' => ['clikgate-installation' => self::HEADER]])?->appId);
        self::assertNull(Installation::fromRequest(['headers' => ['clikgate-installation' => 'nope']]));
        self::assertNull(Installation::fromRequest(['headers' => []]));
        self::assertNull(Installation::fromRequest(new \stdClass()));
        $symfonyLike = new class {
            public object $headers;

            public function __construct()
            {
                $this->headers = new class {
                    /** @return list<string> */
                    public function all(string $name): array
                    {
                        return 'clikgate-installation' === $name ? [InstallationTest::header()] : [];
                    }
                };
            }
        };
        self::assertSame(self::INST, Installation::fromRequest($symfonyLike)?->installationId);
        $throwing = new class {
            public object $headers;

            public function __construct()
            {
                $this->headers = new class {
                    /** @return list<string> */
                    public function all(string $name): array
                    {
                        throw new \RuntimeException('boom');
                    }
                };
            }
        };
        self::assertNull(Installation::fromRequest($throwing));
    }

    public static function header(): string
    {
        return self::HEADER;
    }

    public function testIdentifyUserWithTheHeaderAndWithoutAppId(): void
    {
        $http = new RecordingClient(static fn(): ResponseInterface => new Response(200, ['Content-Type' => 'application/json'], '{"object":"person_identified","person_id":"per_1","label_ignored":null}'));
        $c = $this->client($http);
        $c->identifyUser(['installation' => ' ' . self::HEADER . ' ', 'customerId' => 'user_42']);
        $c->identifyUser(['installationId' => self::INST, 'customerId' => 'user_42']);
        $c->identifyUser(['installation' => self::HEADER, 'installationId' => '6a1f0c2e-0000-4000-8000-000000000002', 'customerId' => 'user_42']);
        $c->identifyUser(['installation' => 'secret-header-value', 'clickId' => 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6']);
        $c->identifyUser(['appId' => self::APP, 'installationId' => self::INST, 'customerId' => 'user_42']);
        self::assertSame([
            ['app_id' => self::APP, 'installation_id' => self::INST, 'customer_id' => 'user_42'],
            ['installation_id' => self::INST, 'customer_id' => 'user_42'],
            ['installation_id' => '6a1f0c2e-0000-4000-8000-000000000002', 'customer_id' => 'user_42'],
            ['click_id' => 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6'],
            ['app_id' => self::APP, 'installation_id' => self::INST, 'customer_id' => 'user_42'],
        ], $http->bodies());
        try {
            $c->identifyUser(['installation' => 'secret-header-value']);
            self::fail('needs a reference');
        } catch (InvalidRequestException $e) {
            self::assertSame('click_id', $e->getParam());
            self::assertStringNotContainsString('secret-header-value', $e->getMessage());
        }
        try {
            $c->identifyUser(['appId' => self::APP]);
            self::fail('needs installationId');
        } catch (InvalidRequestException $e) {
            self::assertSame('installation_id', $e->getParam());
        }
        self::assertCount(5, $http->requests);
    }

    public function testSeveralAppsIsAConflict(): void
    {
        $http = new RecordingClient(static fn(): ResponseInterface => new Response(409, ['Content-Type' => 'application/json'], '{"error":{"type":"conflict","code":"installation_in_several_apps","message":"Send app_id.","param":"app_id","request_id":"req_1"}}'));
        try {
            $this->client($http)->identifyUser(['installationId' => self::INST, 'customerId' => 'user_42']);
            self::fail('409');
        } catch (ConflictException $e) {
            self::assertSame(['installation_in_several_apps', 'app_id', 409], [$e->getErrorCode(), $e->getParam(), $e->getHttpStatus()]);
        }
    }

    public function testPsr15MiddlewareSetsTheInstallationAttribute(): void
    {
        $handler = new class implements RequestHandlerInterface {
            public mixed $seen = 'unset';

            public function handle(ServerRequestInterface $request): ResponseInterface
            {
                $this->seen = $request->getAttribute(ClikgateMiddleware::INSTALLATION_ATTRIBUTE);

                return new Response(200);
            }
        };
        $mw = new ClikgateMiddleware();
        $mw->process((new ServerRequest('GET', 'https://api.example/me'))->withHeader('Clikgate-Installation', self::HEADER), $handler);
        self::assertInstanceOf(Installation::class, $handler->seen);
        self::assertSame(self::APP, $handler->seen->appId);
        $res = $mw->process((new ServerRequest('GET', 'https://api.example/me'))->withHeader('Clikgate-Installation', str_repeat('x', 500)), $handler);
        self::assertNull($handler->seen);
        self::assertSame(200, $res->getStatusCode());
    }

    /** @param array<string, mixed> $options */
    private function client(RecordingClient $http, array $options = []): Clikgate
    {
        return new Clikgate($options + ['apiKey' => self::KEY, 'httpClient' => $http, 'shutdownHooks' => false, 'privateMode' => false]);
    }
}
