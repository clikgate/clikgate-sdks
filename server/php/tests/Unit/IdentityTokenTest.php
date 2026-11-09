<?php

declare(strict_types=1);

namespace Clikgate\Tests\Unit;

use Clikgate\Clikgate;
use Clikgate\Exception\ConfigurationException;
use Clikgate\Exception\InvalidRequestException;
use Clikgate\IdentityToken;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Change 22 I.1: identity tokens against the shared vectors made by the backend signer. */
final class IdentityTokenTest extends TestCase
{
    /** @return array{vectors: list<array{name: string, secret: string, customer_id: string, issued_at: int, token: string}>, invalid: list<array{name: string, customer_id: string}>} */
    private static function vectors(): array
    {
        $json = file_get_contents(__DIR__ . '/../../../conformance/vectors/identity-token-vectors.json');
        self::assertIsString($json);
        $doc = json_decode($json, true, 512, \JSON_THROW_ON_ERROR);
        self::assertIsArray($doc);
        self::assertIsArray($doc['vectors']);
        self::assertIsArray($doc['invalid_customer_ids']);
        $vectors = [];
        foreach ($doc['vectors'] as $v) {
            self::assertIsArray($v);
            self::assertIsString($v['name']);
            self::assertIsString($v['secret']);
            self::assertIsString($v['customer_id']);
            self::assertIsInt($v['issued_at']);
            self::assertIsString($v['token']);
            $vectors[] = ['name' => $v['name'], 'secret' => $v['secret'], 'customer_id' => $v['customer_id'], 'issued_at' => $v['issued_at'], 'token' => $v['token']];
        }
        $invalid = [];
        foreach ($doc['invalid_customer_ids'] as $v) {
            self::assertIsArray($v);
            self::assertIsString($v['name']);
            self::assertIsString($v['customer_id']);
            $invalid[] = ['name' => $v['name'], 'customer_id' => $v['customer_id']];
        }

        return ['vectors' => $vectors, 'invalid' => $invalid];
    }

    /** @return array{name: string, secret: string, customer_id: string, issued_at: int, token: string} */
    private static function vector(string $name): array
    {
        foreach (self::vectors()['vectors'] as $v) {
            if ($v['name'] === $name) {
                return $v;
            }
        }
        self::fail("no vector {$name}");
    }

    protected function setUp(): void
    {
        putenv(IdentityToken::SECRET_ENV);
        putenv(IdentityToken::SECRETS_ENV);
    }

    protected function tearDown(): void
    {
        putenv(IdentityToken::SECRET_ENV);
        putenv(IdentityToken::SECRETS_ENV);
    }

    /** @return iterable<string, array{string, string, int, string}> */
    public static function sharedVectors(): iterable
    {
        foreach (self::vectors()['vectors'] as $v) {
            yield $v['name'] => [$v['secret'], $v['customer_id'], $v['issued_at'], $v['token']];
        }
    }

    #[DataProvider('sharedVectors')]
    public function testMatchesTheSharedVectors(string $secret, string $customerId, int $issuedAt, string $token): void
    {
        self::assertSame($token, IdentityToken::create($customerId, ['secret' => $secret, 'issuedAt' => $issuedAt]));
    }

    public function testSecretFromTheEnvironmentAndThePerAppMap(): void
    {
        $a = self::vector('ascii');
        $other = self::vector('other_app_secret');
        putenv(IdentityToken::SECRET_ENV . '=' . $a['secret']);
        self::assertSame($a['token'], IdentityToken::create('user_42', ['issuedAt' => $a['issued_at']]));
        self::assertSame($a['token'], IdentityToken::create('user_42', ['appId' => 'app_unknown', 'issuedAt' => $a['issued_at']]));
        putenv(IdentityToken::SECRET_ENV);
        putenv(IdentityToken::SECRETS_ENV . '=' . json_encode(['app_shop' => $a['secret'], 'app_rider' => $other['secret']]));
        self::assertSame($other['token'], IdentityToken::create('user_42', ['appId' => 'app_rider', 'issuedAt' => $other['issued_at']]));
        self::assertSame($a['token'], IdentityToken::create('user_42', ['appId' => 'app_shop', 'issuedAt' => $a['issued_at']]));
        try {
            IdentityToken::create('user_42');
            self::fail('expected ConfigurationException');
        } catch (ConfigurationException $e) {
            self::assertSame('missing_identity_secret', $e->getErrorCode());
            self::assertSame('appId', $e->getParam());
        }
    }

    public function testMissingAndMalformedSecrets(): void
    {
        try {
            IdentityToken::create('user_42');
            self::fail('expected ConfigurationException');
        } catch (ConfigurationException $e) {
            self::assertSame('missing_identity_secret', $e->getErrorCode());
        }
        putenv(IdentityToken::SECRETS_ENV . '={not json');
        try {
            IdentityToken::create('user_42', ['appId' => 'app_shop']);
            self::fail('expected ConfigurationException');
        } catch (ConfigurationException $e) {
            self::assertSame('invalid_identity_secrets', $e->getErrorCode());
            self::assertStringNotContainsString('not json', $e->getMessage());
        }
    }

    public function testClientMethodUsesItsOptions(): void
    {
        $a = self::vector('ascii');
        $other = self::vector('other_app_secret');
        $c = new Clikgate(['apiKey' => 'cg_test_unit000000000000', 'shutdownHooks' => false, 'identitySecret' => $a['secret'], 'identitySecrets' => ['app_rider' => $other['secret']]]);
        self::assertSame($a['token'], $c->createIdentityToken('user_42', ['issuedAt' => $a['issued_at']]));
        self::assertSame($other['token'], $c->createIdentityToken('user_42', ['appId' => 'app_rider', 'issuedAt' => $other['issued_at']]));
        $this->expectException(ConfigurationException::class);
        new Clikgate(['apiKey' => 'cg_test_unit000000000000', 'shutdownHooks' => false, 'identitySecrets' => ['app_rider' => 42]]);
    }

    public function testIssuedAtDefaultsToNow(): void
    {
        $before = time();
        $token = IdentityToken::create('user_42', ['secret' => 'cgis_unit']);
        $parts = explode('.', $token);
        self::assertCount(2, $parts);
        self::assertGreaterThanOrEqual($before, (int) $parts[1]);
        self::assertLessThanOrEqual($before + 2, (int) $parts[1]);
        self::assertMatchesRegularExpression('/^[A-Za-z0-9_-]{43}$/', $parts[0]);
    }

    public function testInvalidCustomerIdsAreRefusedWithoutEcho(): void
    {
        $bad = array_merge(self::vectors()['invalid'], [['name' => 'not_utf8', 'customer_id' => "user_\xff"]]);
        foreach ($bad as $case) {
            try {
                IdentityToken::create($case['customer_id'], ['secret' => 'cgis_unit', 'issuedAt' => 1]);
                self::fail("expected InvalidRequestException for {$case['name']}");
            } catch (InvalidRequestException $e) {
                self::assertSame('invalid_customer_id', $e->getErrorCode());
                if ('' !== $case['customer_id']) {
                    self::assertStringNotContainsString($case['customer_id'], $e->getMessage());
                }
            }
        }
        $this->expectException(InvalidRequestException::class);
        IdentityToken::create('user_42', ['secret' => 'cgis_unit', 'issuedAt' => -1]);
    }
}
