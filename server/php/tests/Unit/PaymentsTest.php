<?php

declare(strict_types=1);

namespace Clikgate\Tests\Unit;

use Clikgate\Clikgate;
use Clikgate\Exception\InvalidRequestException;
use Clikgate\Exception\PrivateModeFieldRejectedException;
use Nyholm\Psr7\Response;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;

/** Change 11 (SPEC 22): payments->confirm() and the gateway helpers. */
final class PaymentsTest extends TestCase
{
    private const KEY = 'cg_test_unit000000000000';
    private const CID = 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6';

    private function http(): RecordingClient
    {
        return new RecordingClient(static fn(): ResponseInterface => new Response(200, ['Content-Type' => 'application/json'], '{"object":"payment_confirmation","id":"pcf_1","duplicate":false}'));
    }

    /** @param array<string, mixed> $options */
    private function client(RecordingClient $http, array $options = []): Clikgate
    {
        return new Clikgate($options + ['apiKey' => self::KEY, 'httpClient' => $http, 'shutdownHooks' => false, 'privateMode' => false]);
    }

    public function testConfirmSendsTheWireBody(): void
    {
        $http = $this->http();
        $result = $this->client($http)->payments->confirm(['provider' => 'paystack', 'reference' => 'T_1', 'status' => 'success', 'amount' => '7500.00', 'currency' => 'NGN', 'clickId' => self::CID, 'occurredAt' => new \DateTimeImmutable('2026-10-28T11:00:00+01:00'), 'aliases' => []]);
        self::assertSame('pcf_1', $result['id']);
        self::assertSame('/v1/payments/confirmations', $http->requests[0]->getUri()->getPath());
        self::assertSame([['provider' => 'paystack', 'reference' => 'T_1', 'status' => 'success', 'amount' => '7500.00', 'currency' => 'NGN', 'click_id' => self::CID, 'occurred_at' => '2026-10-28T10:00:00Z']], $http->bodies());
        self::assertMatchesRegularExpression('/^[0-9a-f-]{36}$/', $http->requests[0]->getHeaderLine('Idempotency-Key'));
    }

    public function testFloatAmountIsRefusedLikeGoals(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->client($this->http())->payments->confirm(['provider' => 'paystack', 'reference' => 'T_1', 'status' => 'success', 'amount' => 75.5]);
    }

    public function testGuardNeverReachesTheTransport(): void
    {
        $http = $this->http();
        $c = $this->client($http, ['privateMode' => true]);
        try {
            $c->payments->confirm(['provider' => 'paystack', 'reference' => 'T_1', 'status' => 'success', 'extra' => ['email' => 'ada@example.com']]);
            self::fail('expected the guard');
        } catch (PrivateModeFieldRejectedException $e) {
            self::assertSame('email', $e->getField());
            self::assertStringNotContainsString('ada@example.com', $e->getMessage());
        }
        self::assertSame([], $http->requests);
        $c->payments->confirm(['provider' => 'paystack', 'reference' => 'T_1', 'status' => 'success', 'amount' => '1', 'currency' => 'NGN', 'clickId' => self::CID, 'aliases' => ['A'], 'goal' => 'order_paid', 'test' => true]);
        self::assertCount(1, $http->requests);
    }

    public function testLocalValidation(): void
    {
        $c = $this->client($this->http());
        foreach ([[['status' => 'paid'], 'invalid_status'], [['provider' => 'Paystack'], 'invalid_provider'], [['amountMinor' => 1, 'amount' => '1'], 'amount_and_amount_minor'], [['currency' => 'naira'], 'invalid_currency'], [['nope' => 1], 'invalid_argument']] as [$over, $code]) {
            try {
                $c->payments->confirm($over + ['provider' => 'paystack', 'reference' => 'T_1', 'status' => 'success']);
                self::fail("expected {$code}");
            } catch (InvalidRequestException $e) {
                self::assertSame($code, $e->getErrorCode());
                self::assertNull($e->getHttpStatus());
            }
        }
    }

    public function testExactDecimals(): void
    {
        $p = $this->client($this->http())->payments;
        $amount = static fn(?array $b): mixed => $b['amount'] ?? null;
        self::assertSame('1500.25', $amount($p->buildFromFlutterwave(['data' => ['tx_ref' => 'F', 'status' => 'successful', 'amount' => 1500.25, 'currency' => 'NGN']])));
        self::assertSame('0.1', $amount($p->buildFromFlutterwave(['data' => ['tx_ref' => 'F', 'status' => 'successful', 'amount' => 0.1]])));
        self::assertSame('0.0000001', $amount($p->buildFromFlutterwave(['data' => ['tx_ref' => 'F', 'status' => 'successful', 'amount' => 1e-7]])));
        self::assertSame('100.5', $amount($p->buildFromPaystack(['data' => ['reference' => 'T', 'status' => 'success', 'amount' => 10050]])));
        self::assertSame('0.05', $amount($p->buildFromPaystack(['data' => ['reference' => 'T', 'status' => 'success', 'amount' => '5']])));
        self::assertSame('0', $amount($p->buildFromPaystack(['data' => ['reference' => 'T', 'status' => 'failed', 'amount' => 0]])));
        self::assertNull($amount($p->buildFromPaystack(['data' => ['reference' => 'T', 'status' => 'success', 'amount' => '-5']])));
        // raw JSON text keeps digits a float would lose
        self::assertSame('12345678901234567.89', $amount($p->buildFromFlutterwave('{"data":{"tx_ref":"F","status":"successful","amount":12345678901234567.89}}')));
        self::assertSame('99999999999999999999', $amount($p->buildFromMonnify('{"responseBody":{"paymentReference":"M","paymentStatus":"PAID","amountPaid":99999999999999999999}}')));
        self::assertSame('150', $amount($p->buildFromMonnify('{"responseBody":{"paymentReference":"M","paymentStatus":"PAID","amountPaid":1.5e2}}')));
        self::assertSame('500', $amount($p->buildFromStripe(['object' => 'payment_intent', 'id' => 'pi_1', 'status' => 'succeeded', 'amount' => 50000, 'currency' => 'isk'])));
    }

    public function testHelperSendsAndWarns(): void
    {
        $http = $this->http();
        $logger = new class extends \Psr\Log\AbstractLogger {
            /** @var list<string> */
            public array $warnings = [];

            public function log($level, string|\Stringable $message, array $context = []): void
            {
                $code = $context['clikgate_code'] ?? null;
                if (\is_string($code)) {
                    $this->warnings[] = $code;
                }
            }
        };
        $c = $this->client($http, ['logger' => $logger]);
        self::assertNull($c->payments->fromPaystack(['status' => false, 'message' => 'not found']));
        self::assertSame(['unrecognised_payment_response'], $logger->warnings);
        self::assertNull($c->payments->fromStripe(['object' => 'checkout.session', 'id' => 'cs_1', 'payment_status' => 'no_payment_required']));
        self::assertSame(['unrecognised_payment_response'], $logger->warnings);
        $c->payments->fromPaystack(['data' => ['reference' => 'T', 'status' => 'success', 'amount' => 100, 'currency' => 'ngn', 'customer' => ['email' => 'ada@example.com']]], ['goal' => 'order_paid']);
        self::assertSame([['provider' => 'paystack', 'reference' => 'T', 'status' => 'success', 'amount' => '1', 'currency' => 'NGN', 'goal' => 'order_paid']], $http->bodies());
    }
}
