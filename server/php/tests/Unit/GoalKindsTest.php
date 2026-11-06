<?php

declare(strict_types=1);

namespace Clikgate\Tests\Unit;

use Clikgate\Clikgate;
use Clikgate\Enum\GoalKind;
use Clikgate\Enum\GoalStatus;
use Clikgate\Enum\Provider;
use Clikgate\ErrorContext;
use Clikgate\Exception\ClikgateException;
use Clikgate\Exception\InvalidRequestException;
use Nyholm\Psr7\Response;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;

final class GoalKindsTest extends TestCase
{
    private const KEY = 'cg_test_unit000000000000';

    protected function setUp(): void
    {
        putenv('CLIKGATE_API_KEY');
        putenv('CLIKGATE_BASE_URL');
    }

    /** @param array<string, mixed> $options */
    private function client(RecordingClient $http, array $options = []): Clikgate
    {
        return new Clikgate(['apiKey' => self::KEY, 'httpClient' => $http, 'shutdownHooks' => false, 'privateMode' => false] + $options);
    }

    public function testEnumValues(): void
    {
        self::assertSame(['standard', 'payment'], array_map(static fn(GoalKind $k): string => $k->value, GoalKind::cases()));
        self::assertSame(['counted', 'waiting', 'refused'], array_map(static fn(GoalStatus $s): string => $s->value, GoalStatus::cases()));
        self::assertSame('mtn_momo', Provider::MtnMomo->value);
        self::assertSame(Provider::Paystack, Provider::from('paystack'));
        self::assertNotContains('deferred', array_map(static fn(GoalStatus $s): string => $s->value, GoalStatus::cases()));
        self::assertSame('"counted"', json_encode(GoalStatus::Counted, \JSON_THROW_ON_ERROR));
    }

    public function testProviderOptionEnumAndString(): void
    {
        $http = new RecordingClient();
        $c = $this->client($http);
        $c->goals->send('order_paid', ['reference' => 'T1', 'value' => '7500', 'provider' => Provider::Paystack]);
        $c->goals->send('order_paid', ['reference' => 'T2', 'value' => '10', 'provider' => 'acme_pay']);
        self::assertSame(['paystack', 'acme_pay'], array_map(static fn(array $b): mixed => $b['provider'], $http->bodies()));
    }

    /** @return iterable<string, array{mixed}> */
    public static function badProviders(): iterable
    {
        yield 'upper case' => ['Paystack'];
        yield 'dash' => ['mtn-momo'];
        yield 'empty' => [''];
        yield 'int' => [7];
    }

    #[DataProvider('badProviders')]
    public function testProviderValidation(mixed $bad): void
    {
        $http = new RecordingClient();
        $c = $this->client($http);
        try {
            $c->goals->send('order_paid', ['reference' => 'T1', 'provider' => $bad]);
            self::fail('expected invalid_provider');
        } catch (InvalidRequestException $e) {
            self::assertSame('invalid_provider', $e->getErrorCode());
            self::assertSame('provider', $e->getParam());
            self::assertNull($e->getHttpStatus());
        }
        try {
            $c->goals->sendBatch([['goal' => 'order_paid', 'reference' => 'T0'], ['goal' => 'order_paid', 'reference' => 'T1', 'provider' => $bad]]);
            self::fail('expected invalid_provider');
        } catch (InvalidRequestException $e) {
            self::assertSame('invalid_provider', $e->getErrorCode());
            self::assertSame(1, $e->getIndex());
        }
        self::assertSame([], $http->requests);
    }

    public function testGoalInvalidProviderGoesToOnError(): void
    {
        $http = new RecordingClient();
        $codes = [];
        $c = $this->client($http, ['onError' => static function (ClikgateException $e, ErrorContext $ctx) use (&$codes): void {
            $codes[] = $e->getErrorCode();
        }]);
        $c->goal('order_paid', ['reference' => 'T1', 'provider' => 'Paystack']);
        self::assertSame(['invalid_provider'], $codes);
        self::assertSame([], $http->requests);
    }

    public function testProviderAllowedInPrivateMode(): void
    {
        $http = new RecordingClient();
        $c = $this->client($http, ['privateMode' => true]);
        $c->goals->send('order_paid', ['reference' => 'T1', 'value' => '1', 'provider' => Provider::Stripe]);
        self::assertSame('stripe', $http->bodies()[0]['provider']);
    }

    public function testResultsStayRawAndUnknownValuesAreKept(): void
    {
        $http = new RecordingClient(static fn(): ResponseInterface => new Response(201, [], '{"object":"goal_event","status":"deferred","goal_kind":"subscription","future":1}'));
        $event = $this->client($http)->goals->send('order_paid', ['reference' => 'T1']);
        self::assertSame('deferred', $event['status']);
        self::assertNotContains($event['status'], array_map(static fn(GoalStatus $s): string => $s->value, GoalStatus::cases()));
        self::assertSame(1, $event['future']);
    }

    public function testConfirmTakesProviderEnum(): void
    {
        $http = new RecordingClient(static fn(): ResponseInterface => new Response(200, [], '{"object":"payment_confirmation","id":"pcf_1"}'));
        $this->client($http)->payments->confirm(['provider' => Provider::Flutterwave, 'reference' => 'F1', 'status' => 'success', 'amount' => '10']);
        self::assertSame('flutterwave', $http->bodies()[0]['provider']);
    }
}
