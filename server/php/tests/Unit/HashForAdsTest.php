<?php

declare(strict_types=1);

namespace Clikgate\Tests\Unit;

use Clikgate\Clikgate;
use Clikgate\ErrorContext;
use Clikgate\Exception\ClikgateException;
use Clikgate\Exception\InvalidRequestException;
use Clikgate\Exception\PrivateModeFieldRejectedException;
use Clikgate\HashForAds;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class HashForAdsTest extends TestCase
{
    private const KEY = 'cg_test_unit000000000000';
    // The website's vectors (clikgate_website apps/www/samples/ads-hashing/, SPEC 25)
    private const H_EMAIL = '0f096d5de5ccb3a1e50f34246aab7d9c539de7bd63498d5fae420ecfba31aaed';
    private const H_E164 = '6b39248188406864f30420963a3e793bf8571e2fa733f767889f9fa882b5d14c';
    private const H_DIGITS = 'fe144b034b54f22ea55473f479fe83b2ccbc55af8cdb280ef65ef280bcd4bf17';
    private const CLICK = 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6';

    protected function setUp(): void
    {
        putenv('CLIKGATE_API_KEY');
        putenv('CLIKGATE_BASE_URL');
    }

    /** @param array<string, mixed> $options */
    private function client(RecordingClient $http, array $options = []): Clikgate
    {
        return new Clikgate($options + ['apiKey' => self::KEY, 'httpClient' => $http, 'shutdownHooks' => false, 'privateMode' => false]);
    }

    public function testVectors(): void
    {
        self::assertSame(
            ['hashedEmail' => self::H_EMAIL, 'hashedPhoneE164' => self::H_E164, 'hashedPhoneDigits' => self::H_DIGITS],
            HashForAds::hash('  Ada.Obi@Example.com ', '+234 803 123 4567'),
        );
        self::assertSame(['hashedPhoneE164' => self::H_E164, 'hashedPhoneDigits' => self::H_DIGITS], HashForAds::hash(phone: '00234 (803) 123-4567'));
        self::assertSame(['hashedPhoneE164' => self::H_E164, 'hashedPhoneDigits' => self::H_DIGITS], HashForAds::hash(null, "\t+2348031234567\n"));
        self::assertSame(['hashedEmail' => self::H_EMAIL], HashForAds::hash("\u{00A0}ADA.OBI@EXAMPLE.COM\u{2003}", null));
        self::assertSame([], HashForAds::hash());
    }

    /** @return iterable<string, array{string, string}> */
    public static function refused(): iterable
    {
        yield 'national' => ['phone', '0803 123 4567'];
        yield 'no plus' => ['phone', '2348031234567'];
        yield 'too short' => ['phone', '+12345'];
        yield 'leading zero' => ['phone', '+0803 123 4567'];
        yield 'too long' => ['phone', '+1234567890123456'];
        yield 'empty phone' => ['phone', ''];
        yield 'no at' => ['email', 'ada.obi.example.com'];
        yield 'blank email' => ['email', '   '];
    }

    #[DataProvider('refused')]
    public function testRefusedWithoutEchoing(string $field, string $input): void
    {
        try {
            'email' === $field ? HashForAds::hash($input) : HashForAds::hash(null, $input);
            self::fail('expected InvalidRequestException');
        } catch (InvalidRequestException $e) {
            self::assertSame('invalid_argument', $e->getErrorCode());
            self::assertSame($field, $e->getParam());
            self::assertNull($e->getHttpStatus());
            if ('' !== trim($input)) {
                self::assertStringNotContainsString(trim($input), $e->getMessage());
            }
        }
    }

    public function testGoalWireAndLocalRefusal(): void
    {
        $http = new RecordingClient();
        $c = $this->client($http);
        $c->goals->send('account_opened', ['reference' => 'APP-1', 'clickId' => self::CLICK] + HashForAds::hash('ada.obi@example.com', '+2348031234567'));
        self::assertEquals([[
            'goal' => 'account_opened',
            'reference' => 'APP-1',
            'click_id' => self::CLICK,
            'hashed_email' => self::H_EMAIL,
            'hashed_phone_e164' => self::H_E164,
            'hashed_phone_digits' => self::H_DIGITS,
        ]], $http->bodies());
        foreach ([['hashedEmail', 'hashed_email', strtoupper(self::H_EMAIL)], ['hashedPhoneE164', 'hashed_phone_e164', '+2348031234567'], ['hashedPhoneDigits', 'hashed_phone_digits', substr(self::H_DIGITS, 1)]] as [$option, $field, $value]) {
            try {
                $c->goals->send('account_opened', ['reference' => 'APP-2', $option => $value]);
                self::fail('expected InvalidRequestException');
            } catch (InvalidRequestException $e) {
                self::assertSame('invalid_hashed_identifier', $e->getErrorCode());
                self::assertSame($field, $e->getParam());
                self::assertStringNotContainsString($value, $e->getMessage());
            }
        }
        try {
            $c->goals->sendBatch([['goal' => 'account_opened', 'reference' => 'APP-1'], ['goal' => 'account_opened', 'reference' => 'APP-2', 'hashedPhoneDigits' => 'abc']]);
            self::fail('expected InvalidRequestException');
        } catch (InvalidRequestException $e) {
            self::assertSame('invalid_hashed_identifier', $e->getErrorCode());
            self::assertSame(1, $e->getIndex());
        }
        try {
            $c->conversions->create(['external_id' => 'ORD-1', 'hashed_email' => 'ada@example.com']);
            self::fail('expected InvalidRequestException');
        } catch (InvalidRequestException $e) {
            self::assertSame('invalid_hashed_identifier', $e->getErrorCode());
            self::assertSame('hashed_email', $e->getParam());
        }
        self::assertCount(1, $http->requests);
    }

    public function testGoalNeverLogsHashes(): void
    {
        $http = new RecordingClient();
        $logger = new class extends \Psr\Log\AbstractLogger {
            public string $text = '';

            public function log($level, string|\Stringable $message, array $context = []): void
            {
                $this->text .= $message . json_encode($context) . "\n";
            }
        };
        $seen = [];
        $c = $this->client($http, ['logger' => $logger, 'onError' => static function (ClikgateException $e, ErrorContext $ctx) use (&$seen): void {
            $seen[] = [$e->getErrorCode(), $e->getMessage(), json_encode($ctx->events)];
        }]);
        $c->goal('account_opened', ['reference' => 'APP-1', 'hashedEmail' => self::H_EMAIL, 'hashedPhoneE164' => strtoupper(self::H_E164)]);
        $c->goal('account_opened', ['reference' => 'APP-2', 'hashedEmail' => self::H_EMAIL, 'hashedPhoneDigits' => self::H_DIGITS]);
        self::assertSame(['invalid_hashed_identifier'], array_map(static fn(array $s): mixed => $s[0], $seen));
        self::assertSame(self::H_DIGITS, $http->bodies()[0]['hashed_phone_digits'] ?? null);
        $shown = $logger->text . json_encode($seen);
        foreach ([self::H_EMAIL, self::H_E164, strtoupper(self::H_E164), self::H_DIGITS] as $h) {
            self::assertStringNotContainsString($h, $shown);
        }
    }

    public function testPrivateModeGuardAllowsHashesNotCustomer(): void
    {
        $http = new RecordingClient();
        $c = $this->client($http, ['privateMode' => true]);
        $c->goals->send('account_opened', ['reference' => 'APP-1', 'hashedEmail' => self::H_EMAIL]);
        $c->goals->sendBatch([['goal' => 'account_opened', 'reference' => 'APP-2', 'hashedPhoneE164' => self::H_E164, 'hashedPhoneDigits' => self::H_DIGITS]]);
        $c->conversions->create(['external_id' => 'ORD-1', 'goal' => 'order_paid', 'hashed_phone_e164' => self::H_E164, 'hashed_phone_digits' => self::H_DIGITS]);
        try {
            $c->conversions->create(['external_id' => 'ORD-2', 'customer' => ['email' => 'ada@example.com']]);
            self::fail('expected PrivateModeFieldRejectedException');
        } catch (PrivateModeFieldRejectedException $e) {
            self::assertSame('customer', $e->getParam());
        }
        self::assertCount(3, $http->requests);
        self::assertSame(self::H_DIGITS, $http->bodies()[2]['hashed_phone_digits'] ?? null);
    }
}
