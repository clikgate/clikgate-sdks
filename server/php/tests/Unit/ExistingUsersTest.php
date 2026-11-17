<?php

declare(strict_types=1);

namespace Clikgate\Tests\Unit;

use Clikgate\Clikgate;
use Clikgate\CustomerId;
use Clikgate\Exception\ConflictException;
use Clikgate\Exception\InvalidRequestException;
use Clikgate\Exception\PrivateModeFieldRejectedException;
use Clikgate\IdentityToken;
use Nyholm\Psr7\Response;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;

/** Identity token version 2, the canonical customer ID, customerSince on identifyUser, known customers. */
final class ExistingUsersTest extends TestCase
{
    private const KEY = 'cg_test_unit000000000000';

    /** @return array<string, mixed> */
    private static function load(string $file): array
    {
        $json = file_get_contents(__DIR__ . '/../../../conformance/vectors/' . $file);
        self::assertIsString($json);
        $doc = json_decode($json, true, 512, \JSON_THROW_ON_ERROR);
        self::assertIsArray($doc);

        /** @var array<string, mixed> $doc */
        return $doc;
    }

    /** @return \Generator<string, array{array<string, mixed>}> */
    private static function named(mixed $list): \Generator
    {
        self::assertIsArray($list);
        foreach ($list as $v) {
            self::assertIsArray($v);
            self::assertIsString($v['name']);
            $named = [];
            foreach ($v as $k => $value) {
                $named[(string) $k] = $value;
            }
            yield $v['name'] => [$named];
        }
    }

    /** @return iterable<string, array{array<string, mixed>}> */
    public static function v2Vectors(): iterable
    {
        yield from self::named(self::load('identity-token-vectors.json')['v2']);
    }

    /** @return iterable<string, array{array<string, mixed>}> */
    public static function idVectors(): iterable
    {
        yield from self::named(self::load('customer-id-vectors.json')['vectors']);
    }

    /** @param array<string, mixed> $v */
    #[DataProvider('v2Vectors')]
    public function testVersion2TokensMatchTheVectors(array $v): void
    {
        self::assertIsString($v['customer_id']);
        self::assertIsString($v['secret']);
        self::assertIsInt($v['customer_since']);
        self::assertIsInt($v['issued_at']);
        self::assertSame($v['token'], IdentityToken::create($v['customer_id'], ['secret' => $v['secret'], 'issuedAt' => $v['issued_at'], 'customerSince' => $v['customer_since']]));
    }

    public function testCustomerSinceAsDateTime(): void
    {
        $token = IdentityToken::create('user_42', ['secret' => 'cgis_VectorOnly0000000000000000000000000000', 'issuedAt' => 1767225600, 'customerSince' => new \DateTimeImmutable('@1709370000')]);
        self::assertSame('qBG_O-Mdj1XJw1N-WtehwPjrdUgz4dvP9zG-eE0tVm8.1767225600.1709370000', $token);
    }

    public function testAccountDatesOutOfRangeAreRefused(): void
    {
        foreach ((array) self::load('identity-token-vectors.json')['v2_invalid_customer_since'] as $bad) {
            self::assertIsArray($bad);
            self::assertIsInt($bad['issued_at']);
            self::assertIsInt($bad['customer_since']);
            try {
                IdentityToken::create('user_42', ['secret' => 'cgis_unit', 'issuedAt' => $bad['issued_at'], 'customerSince' => $bad['customer_since']]);
                self::fail('accepted an out-of-range account date');
            } catch (InvalidRequestException $e) {
                self::assertSame('customer_since', $e->getParam());
            }
        }
    }

    /** @param array<string, mixed> $v */
    #[DataProvider('idVectors')]
    public function testCanonicalCustomerIdsAndWarnings(array $v): void
    {
        self::assertIsString($v['input']);
        self::assertSame($v['canonical'], CustomerId::canonical($v['input']));
        self::assertSame($v['warning'], CustomerId::warning($v['input'], (bool) $v['allow_11_digit_ids']));
    }

    /** @param array<string, mixed> $options */
    private function client(RecordingClient $http, array $options = []): Clikgate
    {
        return new Clikgate($options + ['apiKey' => self::KEY, 'httpClient' => $http, 'shutdownHooks' => false, 'privateMode' => false]);
    }

    private static function json(mixed $body): ResponseInterface
    {
        return new Response(200, ['Content-Type' => 'application/json'], json_encode($body, \JSON_THROW_ON_ERROR));
    }

    public function testIdentifyUserSendsCustomerSince(): void
    {
        $http = new RecordingClient(static fn(): ResponseInterface => self::json(['object' => 'person_identified', 'person_id' => 'per_1', 'label_ignored' => null]));
        $c = $this->client($http);
        $c->identifyUser(['customerId' => 'u_1', 'customerSince' => '2024-03-02']);
        $c->identifyUser(['customerId' => 'u_1', 'customerSince' => 1709370000, 'customerSinceReplace' => true]);
        $c->identifyUser(['customerId' => 'u_1', 'customerSince' => new \DateTimeImmutable('2024-03-02T10:00:00+01:00')]);
        self::assertSame([
            ['customer_id' => 'u_1', 'customer_since' => '2024-03-02'],
            ['customer_id' => 'u_1', 'customer_since' => '2024-03-02T09:00:00Z', 'customer_since_replace' => true],
            ['customer_id' => 'u_1', 'customer_since' => '2024-03-02T09:00:00Z'],
        ], $http->bodies());
        try {
            $c->identifyUser(['appId' => 'app_1', 'installationId' => 'i', 'customerSince' => '2024-03-02']);
            self::fail('needs customerId');
        } catch (InvalidRequestException $e) {
            self::assertSame('customer_since', $e->getParam());
        }
        $this->expectException(InvalidRequestException::class);
        $c->identifyUser(['customerId' => 'u_1', 'customerSince' => 'March 2024']);
    }

    public function testPrivateModeRefusesCustomerSinceAndKnownCustomers(): void
    {
        $http = new RecordingClient();
        $c = $this->client($http, ['privateMode' => true]);
        try {
            $c->identifyUser(['appId' => 'app_1', 'installationId' => 'i', 'customerId' => 'u_1', 'customerSince' => '2024-03-02']);
            self::fail('guard');
        } catch (PrivateModeFieldRejectedException) {
        }
        foreach ([static fn() => $c->knownCustomers->import([['customerId' => 'u_1']]), static fn() => $c->knownCustomers->remove('u_1')] as $call) {
            try {
                $call();
                self::fail('private mode');
            } catch (ConflictException $e) {
                self::assertSame('private_mode_conflict', $e->getErrorCode());
                self::assertNull($e->getHttpStatus());
            }
        }
        self::assertSame([], $http->requests);
    }

    public function testImportBatchesBy10000AndSumsCounts(): void
    {
        $answers = [
            ['accepted' => 9990, 'refused' => 10, 'refused_by_reason' => ['looks_like_phone' => 10]],
            ['accepted' => 9998, 'refused' => 2, 'refused_by_reason' => ['looks_like_phone' => 1, 'bad_date' => 1]],
            ['accepted' => 5, 'refused' => 0, 'refused_by_reason' => []],
        ];
        $http = new RecordingClient(static function () use (&$answers): ResponseInterface {
            return self::json(array_shift($answers));
        });
        $c = $this->client($http);
        $rows = [
            ['customerId' => 'u_0', 'customerSince' => new \DateTimeImmutable('2024-03-02T23:30:00Z')],
            ['customerId' => 'u_1', 'customerSince' => 1709337600],
        ];
        for ($i = 2; $i < 20005; ++$i) {
            $rows[] = ['customerId' => "u_{$i}"];
        }
        $result = $c->knownCustomers->import($rows, ['idempotencyKey' => 'imp-1']);
        self::assertSame(['accepted' => 19993, 'refused' => 12, 'refused_by_reason' => ['looks_like_phone' => 11, 'bad_date' => 1]], $result);
        $bodies = $http->bodies();
        self::assertCount(3, $bodies);
        self::assertIsArray($bodies[0]['customers']);
        self::assertCount(10000, $bodies[0]['customers']);
        self::assertSame([['customer_id' => 'u_0', 'customer_since' => '2024-03-02'], ['customer_id' => 'u_1', 'customer_since' => '2024-03-02'], ['customer_id' => 'u_2']], \array_slice($bodies[0]['customers'], 0, 3));
        self::assertIsArray($bodies[2]['customers']);
        self::assertCount(5, $bodies[2]['customers']);
        self::assertSame(['imp-1-0', 'imp-1-1', 'imp-1-2'], $http->headers('Idempotency-Key'));
        foreach ($http->requests as $r) {
            self::assertSame('/v1/known-customers/import', $r->getUri()->getPath());
        }
        self::assertSame(['accepted' => 0, 'refused' => 0, 'refused_by_reason' => []], $c->knownCustomers->import([]));
    }

    public function testRemoveSendsTheIdInTheBody(): void
    {
        $http = new RecordingClient(static fn(): ResponseInterface => self::json(['removed' => true]));
        $c = $this->client($http);
        self::assertSame(['removed' => true], $c->knownCustomers->remove('u_10482'));
        self::assertSame('/v1/known-customers/remove', $http->requests[0]->getUri()->getPath());
        self::assertStringNotContainsString('u_10482', (string) $http->requests[0]->getUri());
        self::assertSame([['customer_id' => 'u_10482']], $http->bodies());
    }
}
