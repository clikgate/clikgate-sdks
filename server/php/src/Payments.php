<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Enum\Provider;
use Clikgate\Exception\ErrorMapper;
use Clikgate\Exception\InvalidRequestException;
use Clikgate\Http\ApiRequest;
use Clikgate\Http\Requester;

/**
 * Payments confirmed by your server (SPEC section 22).
 *
 * Your website or app **reports** a payment by sending a Payment goal with `goal()` (with `provider` and
 * `reference`, never an amount). Your server **confirms** it with these methods, right after your own verification
 * with the gateway. Clikgate then counts the Payment goal with the confirmed amount. The SDK never talks to a gateway and never takes a
 * gateway key. Never call these methods with data that came from the browser or the app.
 *
 * ```php
 * // after your own GET https://api.paystack.co/transaction/verify/{reference}
 * $clikgate->payments->fromPaystack($verifyResponse);
 * ```
 *
 * `confirm()` options (`POST /v1/payments/confirmations`): `provider` (a `Provider`, or a provider-key string for a
 * gateway newer than this release), `reference`, `status` (`success`, `partial`,
 * `pending`, `failed`, `refunded` or `reversed`), `amount` (normal units, a decimal string or an int) or
 * `amountMinor`, `currency`, `occurredAt` (`DateTimeInterface` or an RFC 3339 string), `aliases` (at most 5),
 * `clickId`, `goal`, `test`, `extra` (additional wire fields). The snake_case wire names are accepted too.
 *
 * @phpstan-type ConfirmOptions array{provider?: Provider|string, reference?: string, status?: string, amount?: string|int|null, amountMinor?: ?int, currency?: ?string, occurredAt?: \DateTimeInterface|string|null, aliases?: ?list<string>, clickId?: ?string, goal?: ?string, test?: ?bool, extra?: ?array<string, mixed>}
 * @phpstan-type HelperOptions array{goal?: ?string, clickId?: ?string, click_id?: ?string}
 */
final class Payments
{
    public const STATUSES = ['success', 'partial', 'pending', 'failed', 'refunded', 'reversed'];

    /** Option name => wire name. */
    private const OPTIONS = [
        'provider' => 'provider', 'reference' => 'reference', 'status' => 'status', 'amount' => 'amount',
        'amountMinor' => 'amount_minor', 'amount_minor' => 'amount_minor', 'currency' => 'currency',
        'occurredAt' => 'occurred_at', 'occurred_at' => 'occurred_at', 'aliases' => 'aliases',
        'clickId' => 'click_id', 'click_id' => 'click_id', 'goal' => 'goal', 'test' => 'test', 'extra' => 'extra',
    ];

    private const PAYSTACK = [
        'success' => 'success', 'failed' => 'failed', 'abandoned' => 'failed', 'reversed' => 'reversed',
        'ongoing' => 'pending', 'pending' => 'pending', 'processing' => 'pending', 'queued' => 'pending',
    ];
    private const FLUTTERWAVE = ['successful' => 'success', 'succeeded' => 'success', 'failed' => 'failed', 'voided' => 'failed'];
    private const MONNIFY = [
        'PAID' => 'success', 'OVERPAID' => 'success', 'PARTIALLY_PAID' => 'partial', 'FAILED' => 'failed',
        'CANCELLED' => 'failed', 'ABANDONED' => 'failed', 'EXPIRED' => 'failed', 'PENDING' => 'pending', 'REVERSED' => 'reversed',
    ];
    private const STRIPE_PI = ['succeeded' => 'success', 'canceled' => 'failed', 'processing' => 'pending'];
    /** Zero-decimal for Stripe (ISK and UGX are not here: Stripe sends them ×100). */
    private const STRIPE_ZERO_DECIMAL = ['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];

    /** @internal */
    public function __construct(private readonly Core $core) {}

    /**
     * Confirm a payment after your own verification (`POST /v1/payments/confirmations`). Returns the
     * `payment_confirmation` object; a repeat (same provider, reference, status and amount) returns it with
     * `duplicate: true`. Throws on failure, like `goals->send()`.
     *
     * ```php
     * $clikgate->payments->confirm(['provider' => Provider::Paystack, 'reference' => 'T_ref_001', 'status' => 'success', 'amount' => '7500.00', 'currency' => 'NGN']);
     * ```
     *
     * @param array<string, mixed> $options        see {@see Payments}
     * @param array<string, mixed> $requestOptions `idempotencyKey`, `timeout`, `maxRetries`
     *
     * @return array<string, mixed>
     *
     * @throws InvalidRequestException local validation (`invalid_provider`, `invalid_reference`, `invalid_status`,
     *                                 `invalid_amount`, `amount_and_amount_minor`, `invalid_currency`,
     *                                 `invalid_aliases`, `invalid_goal_key`) or an API error
     */
    public function confirm(array $options, array $requestOptions = []): array
    {
        return $this->send(self::wire($options), $requestOptions);
    }

    /**
     * Confirm a Paystack payment from the `GET /transaction/verify/{reference}` body your server just received
     * (or its `data`). Reads only the reference, status, amount (÷ 100), currency, time, `domain` and
     * `metadata.cg_click_id`. Returns the confirmation, or null when there is nothing to send.
     *
     * ```php
     * $verify = json_decode($paystackResponseBody, true);
     * if ('success' === ($verify['data']['status'] ?? null)) {
     *     // ...fulfil the order...
     *     $clikgate->payments->fromPaystack($verify, ['goal' => 'order_paid']);
     * }
     * ```
     *
     * @param array<array-key, mixed>|string $response the decoded body or the raw JSON text
     * @param array<string, mixed>           $options  `goal`, `clickId`
     * @param array<string, mixed>           $requestOptions
     *
     * @return array<string, mixed>|null
     */
    public function fromPaystack(array|string $response, array $options = [], array $requestOptions = []): ?array
    {
        return $this->from('paystack', 'fromPaystack', $response, $options, $requestOptions);
    }

    /**
     * Confirm a Flutterwave payment from the v3 `GET /v3/transactions/{id}/verify` (or `verify_by_reference`)
     * body. Reads only `tx_ref`, `id`, `flw_ref`, status, amount, currency, `created_at` and `meta.cg_click_id`.
     *
     * ```php
     * $clikgate->payments->fromFlutterwave($verifyResponse, ['goal' => 'order_paid']);
     * ```
     *
     * @param array<array-key, mixed>|string $response
     * @param array<string, mixed>           $options
     * @param array<string, mixed>           $requestOptions
     *
     * @return array<string, mixed>|null
     */
    public function fromFlutterwave(array|string $response, array $options = [], array $requestOptions = []): ?array
    {
        return $this->from('flutterwave', 'fromFlutterwave', $response, $options, $requestOptions);
    }

    /**
     * Confirm a Monnify payment from the `GET /api/v2/transactions/{transactionReference}` (or
     * `/api/v2/merchant/transactions/query`) body. Reads only `paymentReference`, `transactionReference`,
     * `paymentStatus`, `amountPaid`, currency, an ISO `paidOn` and `metaData.cg_click_id`.
     *
     * ```php
     * $clikgate->payments->fromMonnify($statusResponse);
     * ```
     *
     * @param array<array-key, mixed>|string $response
     * @param array<string, mixed>           $options
     * @param array<string, mixed>           $requestOptions
     *
     * @return array<string, mixed>|null
     */
    public function fromMonnify(array|string $response, array $options = [], array $requestOptions = []): ?array
    {
        return $this->from('monnify', 'fromMonnify', $response, $options, $requestOptions);
    }

    /**
     * Confirm a Stripe payment from a PaymentIntent (`pi_...`) or a Checkout Session (`cs_...`) you retrieved or
     * received in a webhook you verified. A session with `no_payment_required` sends nothing (null).
     *
     * ```php
     * $intent = $stripe->paymentIntents->retrieve($id);
     * $clikgate->payments->fromStripe($intent->toArray());
     * ```
     *
     * @param array<array-key, mixed>|string $object
     * @param array<string, mixed>           $options
     * @param array<string, mixed>           $requestOptions
     *
     * @return array<string, mixed>|null
     */
    public function fromStripe(array|string $object, array $options = [], array $requestOptions = []): ?array
    {
        return $this->from('stripe', 'fromStripe', $object, $options, $requestOptions);
    }

    /**
     * The wire body {@see fromPaystack()} would send, or null. Pure: no request, no config, no guard.
     *
     * ```php
     * $body = $clikgate->payments->buildFromPaystack($verifyResponse); // ['provider' => 'paystack', 'reference' => ..., 'amount' => '7500', ...]
     * ```
     *
     * @param array<array-key, mixed>|string $response
     * @param array<string, mixed>           $options
     *
     * @return array<string, mixed>|null
     */
    public function buildFromPaystack(array|string $response, array $options = []): ?array
    {
        return self::build('paystack', $response, $options)[0];
    }

    /**
     * The wire body {@see fromFlutterwave()} would send, or null.
     *
     * ```php
     * $body = $clikgate->payments->buildFromFlutterwave($verifyResponse);
     * ```
     *
     * @param array<array-key, mixed>|string $response
     * @param array<string, mixed>           $options
     *
     * @return array<string, mixed>|null
     */
    public function buildFromFlutterwave(array|string $response, array $options = []): ?array
    {
        return self::build('flutterwave', $response, $options)[0];
    }

    /**
     * The wire body {@see fromMonnify()} would send, or null.
     *
     * ```php
     * $body = $clikgate->payments->buildFromMonnify($statusResponse);
     * ```
     *
     * @param array<array-key, mixed>|string $response
     * @param array<string, mixed>           $options
     *
     * @return array<string, mixed>|null
     */
    public function buildFromMonnify(array|string $response, array $options = []): ?array
    {
        return self::build('monnify', $response, $options)[0];
    }

    /**
     * The wire body {@see fromStripe()} would send, or null.
     *
     * ```php
     * $body = $clikgate->payments->buildFromStripe($session->toArray());
     * ```
     *
     * @param array<array-key, mixed>|string $object
     * @param array<string, mixed>           $options
     *
     * @return array<string, mixed>|null
     */
    public function buildFromStripe(array|string $object, array $options = []): ?array
    {
        return self::build('stripe', $object, $options)[0];
    }

    /**
     * @param array<array-key, mixed>|string $response
     * @param array<string, mixed>           $options
     * @param array<string, mixed>           $requestOptions
     *
     * @return array<string, mixed>|null
     */
    private function from(string $gateway, string $method, array|string $response, array $options, array $requestOptions): ?array
    {
        [$body, $quiet] = self::build($gateway, $response, $options);
        if (null === $body) {
            if (!$quiet) {
                $this->core->warn('unrecognised_payment_response', "payments->{$method}(): the response has no reference or a status Clikgate doesn't recognise, so nothing was sent. Pass the gateway's verify response (or call payments->confirm()).");
            }

            return null;
        }
        $wire = [];
        foreach ($body as $k => $v) {
            $wire[(string) $k] = $v;
        }

        return $this->send(self::check($wire), $requestOptions);
    }

    /**
     * @param array<string, mixed> $wire
     * @param array<string, mixed> $requestOptions
     *
     * @return array<string, mixed>
     */
    private function send(array $wire, array $requestOptions): array
    {
        if ($this->core->guardState()[0]) {
            Guard::check('payment_confirmation', $wire);
        }
        [, $data] = $this->core->requester->request((new ApiRequest('POST', '/v1/payments/confirmations'))->withBody($wire)->withOptions($requestOptions));

        return Links::arr($data);
    }

    /**
     * @internal Validate `confirm()` options and build the wire body (SPEC 22.2).
     *
     * @param array<string, mixed> $options
     *
     * @return array<string, mixed>
     */
    public static function wire(array $options): array
    {
        $wire = [];
        $extra = null;
        foreach ($options as $k => $v) {
            $name = self::OPTIONS[$k] ?? null;
            if (null === $name) {
                throw ErrorMapper::local('invalid_argument', \sprintf('Unknown payments->confirm() option "%s". Options: %s.', $k, implode(', ', array_keys(self::OPTIONS))), (string) $k);
            }
            if ('extra' === $name) {
                $extra = $v;
            } elseif (null !== $v && !isset($wire[$name])) {
                $wire[$name] = $v;
            }
        }
        if (isset($wire['amount'])) {
            if (isset($wire['amount_minor'])) {
                throw ErrorMapper::local('amount_and_amount_minor', 'Send either amount or amountMinor, not both.', 'amount');
            }
            try {
                $wire['amount'] = Money::formatValue($wire['amount']);
            } catch (InvalidRequestException) {
                throw ErrorMapper::local('invalid_amount', "amount must be a non-negative decimal number in normal units, like '7500.00'.", 'amount');
            }
        }
        if (isset($wire['occurred_at'])) {
            $occurred = $wire['occurred_at'];
            if (!\is_string($occurred) && !$occurred instanceof \DateTimeInterface) {
                throw ErrorMapper::local('invalid_argument', 'occurredAt must be a DateTimeInterface or an RFC 3339 string.', 'occurred_at');
            }
            $wire['occurred_at'] = Requester::formatDate($occurred);
        }
        if ([] === ($wire['aliases'] ?? null)) {
            unset($wire['aliases']);
        }
        $wire = self::check($wire);
        if (\is_array($extra)) {
            foreach ($extra as $k => $v) {
                $wire[(string) $k] = $v;
            }
        }

        return array_filter($wire, static fn(mixed $v): bool => null !== $v);
    }

    /**
     * Local checks on a wire body (SPEC 22.2), shared by `confirm()` and the helpers.
     *
     * @param array<string, mixed> $wire
     *
     * @return array<string, mixed>
     */
    private static function check(array $wire): array
    {
        $provider = $wire['provider'] ?? null;
        if ($provider instanceof Provider) {
            $provider = $wire['provider'] = $provider->value;
        }
        if (!\is_string($provider) || 1 !== preg_match('/^[a-z][a-z0-9_]{1,29}$/D', $provider)) {
            throw ErrorMapper::local('invalid_provider', 'provider must be a provider key such as "paystack" (lower case, see GET /v1/payment-gateways).', 'provider');
        }
        $reference = $wire['reference'] ?? null;
        if (!\is_string($reference) || '' === $reference || mb_strlen($reference) > 128) {
            throw ErrorMapper::local('invalid_reference', "reference is required: the gateway's payment reference, 1-128 characters.", 'reference');
        }
        if (!\in_array($wire['status'] ?? null, self::STATUSES, true)) {
            throw ErrorMapper::local('invalid_status', 'status must be one of ' . implode(', ', self::STATUSES) . '.', 'status');
        }
        if (isset($wire['amount_minor']) && (!\is_int($wire['amount_minor']) || $wire['amount_minor'] < 0)) {
            throw ErrorMapper::local('invalid_amount', 'amountMinor must be a non-negative integer in ISO 4217 minor units.', 'amount_minor');
        }
        if (isset($wire['currency']) && (!\is_string($wire['currency']) || 1 !== preg_match('/^[A-Za-z]{3}$/D', $wire['currency']))) {
            throw ErrorMapper::local('invalid_currency', 'currency must be an ISO 4217 code, like "NGN".', 'currency');
        }
        if (isset($wire['aliases'])) {
            $aliases = $wire['aliases'];
            if (!\is_array($aliases) || !array_is_list($aliases) || \count($aliases) > 5 || [] !== array_filter($aliases, static fn(mixed $a): bool => !\is_string($a))) {
                throw ErrorMapper::local('invalid_aliases', 'aliases must be a list of at most 5 strings (other references of the same payment).', 'aliases');
            }
        }
        if (isset($wire['goal']) && (!\is_string($wire['goal']) || 1 !== preg_match('/^[a-z][a-z0-9_]{1,39}$/D', $wire['goal']))) {
            throw ErrorMapper::local('invalid_goal_key', 'Goal keys are snake_case, 2-40 characters, starting with a letter (e.g. "order_paid").', 'goal');
        }
        if (isset($wire['test']) && !\is_bool($wire['test'])) {
            throw ErrorMapper::local('invalid_argument', 'test must be a boolean.', 'test');
        }
        if (isset($wire['click_id']) && !\is_string($wire['click_id'])) {
            throw ErrorMapper::local('invalid_argument', 'clickId must be a string.', 'click_id');
        }

        return $wire;
    }

    // ------------------------------------------------------------------ extraction (SPEC 22.3)

    /**
     * @param array<array-key, mixed>|string $response
     * @param array<string, mixed>           $options
     *
     * @return array{0: array<string, mixed>|null, 1: bool} the body (or null) and whether a null is expected (no warning)
     */
    private static function build(string $gateway, array|string $response, array $options): array
    {
        foreach (array_keys($options) as $k) {
            if (!\in_array($k, ['goal', 'clickId', 'click_id'], true)) {
                throw ErrorMapper::local('invalid_argument', \sprintf('Unknown payment helper option "%s". Options: goal, clickId.', $k), (string) $k);
            }
        }
        $root = self::map(\is_string($response) ? self::parse($response) : $response);
        if (null === $root) {
            return [null, false];
        }
        [$body, $quiet] = match ($gateway) {
            'paystack' => [self::paystack($root), false],
            'flutterwave' => [self::flutterwave($root), false],
            'monnify' => [self::monnify($root), false],
            default => self::stripe($root),
        };
        if (null === $body) {
            return [null, $quiet];
        }
        $goal = $options['goal'] ?? null;
        if (null !== $goal) {
            $body['goal'] = $goal;
        }
        $click = $options['clickId'] ?? $options['click_id'] ?? null;
        if (null !== $click) {
            $body['click_id'] = $click;
        }

        return [$body, false];
    }

    /**
     * @param array<array-key, mixed> $r
     *
     * @return array<string, mixed>|null
     */
    private static function paystack(array $r): ?array
    {
        $d = self::map($r['data'] ?? null) ?? $r;
        $reference = self::str($d['reference'] ?? null);
        $status = self::PAYSTACK[strtolower(self::str($d['status'] ?? null) ?? '')] ?? null;
        if (null === $reference || null === $status) {
            return null;
        }
        $domain = $d['domain'] ?? null;

        return self::body(Provider::Paystack->value, $reference, [], $status, self::shift(self::decimal($d['amount'] ?? null), -2), $d['currency'] ?? null, self::first($d, ['paid_at', 'paidAt', 'created_at']), \is_string($domain) ? 'test' === $domain : null, self::click($d['metadata'] ?? null));
    }

    /**
     * @param array<array-key, mixed> $r
     *
     * @return array<string, mixed>|null
     */
    private static function flutterwave(array $r): ?array
    {
        $d = self::map($r['data'] ?? null) ?? $r;
        $reference = self::str($d['tx_ref'] ?? null) ?? self::str($d['reference'] ?? null);
        if (null === $reference) {
            return null;
        }
        $status = self::FLUTTERWAVE[strtolower(self::str($d['status'] ?? null) ?? '')] ?? 'pending';

        return self::body(Provider::Flutterwave->value, $reference, [$d['id'] ?? null, $d['flw_ref'] ?? null], $status, self::decimal($d['amount'] ?? null), $d['currency'] ?? null, self::first($d, ['created_at', 'created_datetime']), null, self::click($d['meta'] ?? null) ?? self::click($d['meta_data'] ?? null));
    }

    /**
     * @param array<array-key, mixed> $r
     *
     * @return array<string, mixed>|null
     */
    private static function monnify(array $r): ?array
    {
        $d = self::map($r['responseBody'] ?? null) ?? $r;
        $d = self::map($d['eventData'] ?? null) ?? $d;
        $reference = self::str($d['paymentReference'] ?? null);
        $status = self::MONNIFY[strtoupper(self::str($d['paymentStatus'] ?? null) ?? '')] ?? null;
        if (null === $reference || null === $status) {
            return null;
        }
        $paidOn = $d['paidOn'] ?? null;

        return self::body(Provider::Monnify->value, $reference, [$d['transactionReference'] ?? null], $status, self::decimal($d['amountPaid'] ?? null), self::str($d['currency'] ?? null) ?? ($d['currencyCode'] ?? null), \is_string($paidOn) ? $paidOn : null, null, self::click($d['metaData'] ?? null));
    }

    /**
     * @param array<array-key, mixed> $o
     *
     * @return array{0: array<string, mixed>|null, 1: bool}
     */
    private static function stripe(array $o): array
    {
        $kind = $o['object'] ?? null;
        $currency = self::str($o['currency'] ?? null);
        $code = null === $currency ? null : strtoupper($currency);
        $livemode = $o['livemode'] ?? null;
        $test = \is_bool($livemode) ? !$livemode : null;
        $click = self::click($o['metadata'] ?? null);
        if ('payment_intent' === $kind) {
            $s = strtolower(self::str($o['status'] ?? null) ?? '');
            $status = self::STRIPE_PI[$s] ?? (str_starts_with($s, 'requires_') ? 'pending' : null);
            $reference = self::str($o['id'] ?? null);
            if (null === $status || null === $reference) {
                return [null, false];
            }
            $received = self::decimal($o['amount_received'] ?? null);
            $amount = null !== $received && '0' !== self::format($received) ? $received : self::decimal($o['amount'] ?? null);

            return [self::body(Provider::Stripe->value, $reference, [], $status, self::stripeAmount($amount, $code), $code, $o['created'] ?? null, $test, $click), false];
        }
        if ('checkout.session' === $kind) {
            $paymentStatus = strtolower(self::str($o['payment_status'] ?? null) ?? '');
            if ('no_payment_required' === $paymentStatus) {
                return [null, true];
            }
            $status = 'paid' === $paymentStatus ? 'success' : ('expired' === strtolower(self::str($o['status'] ?? null) ?? '') ? 'failed' : 'pending');
            $sessionId = self::str($o['id'] ?? null);
            $intent = $o['payment_intent'] ?? null;
            $intentMap = self::map($intent);
            $intentId = self::str(null !== $intentMap ? ($intentMap['id'] ?? null) : $intent);
            $reference = $intentId ?? $sessionId;
            if (null === $reference) {
                return [null, false];
            }

            return [self::body(Provider::Stripe->value, $reference, [$sessionId, $o['client_reference_id'] ?? null], $status, self::stripeAmount(self::decimal($o['amount_total'] ?? null), $code), $code, $o['created'] ?? null, $test, $click), false];
        }

        return [null, false];
    }

    /**
     * @param array{0: string, 1: int}|null $amount
     *
     * @return array{0: string, 1: int}|null
     */
    private static function stripeAmount(?array $amount, ?string $currency): ?array
    {
        return null !== $currency && \in_array($currency, self::STRIPE_ZERO_DECIMAL, true) ? $amount : self::shift($amount, -2);
    }

    /**
     * @param list<mixed>                   $aliases
     * @param array{0: string, 1: int}|null $amount
     *
     * @return array<string, mixed>
     */
    private static function body(string $provider, string $reference, array $aliases, string $status, ?array $amount, mixed $currency, mixed $time, ?bool $test, ?string $click): array
    {
        $body = ['provider' => $provider, 'reference' => $reference];
        $kept = [];
        foreach ($aliases as $a) {
            $s = self::str($a);
            if (null !== $s && $s !== $reference && !\in_array($s, $kept, true)) {
                $kept[] = $s;
            }
        }
        if ([] !== $kept) {
            $body['aliases'] = \array_slice($kept, 0, 5);
        }
        $body['status'] = $status;
        if (null !== $amount) {
            $body['amount'] = self::format($amount);
        }
        $c = self::str($currency);
        if (null !== $c) {
            $body['currency'] = strtoupper($c);
        }
        $occurred = self::time($time);
        if (null !== $occurred) {
            $body['occurred_at'] = $occurred;
        }
        if (null !== $test) {
            $body['test'] = $test;
        }
        if (null !== $click) {
            $body['click_id'] = $click;
        }

        return $body;
    }

    /**
     * The first of `$keys` that is present and not empty.
     *
     * @param array<array-key, mixed> $d
     * @param list<string>            $keys
     */
    private static function first(array $d, array $keys): mixed
    {
        foreach ($keys as $k) {
            $v = $d[$k] ?? null;
            if (null !== $v && '' !== $v) {
                return $v;
            }
        }

        return null;
    }

    /** @return array<array-key, mixed>|null an object (a non-list array), else null */
    private static function map(mixed $v): ?array
    {
        return \is_array($v) && (!array_is_list($v) || [] === $v) ? $v : null;
    }

    private static function str(mixed $v): ?string
    {
        if (\is_int($v)) {
            return (string) $v;
        }
        if (!\is_string($v)) {
            return null;
        }
        $s = trim($v);

        return '' === $s ? null : $s;
    }

    private static function click(mixed $metadata): ?string
    {
        $m = self::map(\is_string($metadata) ? self::parse($metadata) : $metadata);
        $id = null === $m ? null : ($m['cg_click_id'] ?? null);

        return ClickIds::isValid($id) && \is_string($id) ? $id : null;
    }

    /**
     * Decode JSON text keeping every number exact: numbers with a fraction or an exponent become strings
     * before decoding, and big integers stay strings.
     */
    private static function parse(string $json): mixed
    {
        $out = '';
        $n = \strlen($json);
        for ($i = 0; $i < $n;) {
            $ch = $json[$i];
            if ('"' === $ch) {
                $j = $i + 1;
                while ($j < $n && '"' !== $json[$j]) {
                    $j += '\\' === $json[$j] ? 2 : 1;
                }
                $out .= substr($json, $i, $j - $i + 1);
                $i = $j + 1;
            } elseif ('-' === $ch || ctype_digit($ch)) {
                $j = $i + 1;
                while ($j < $n && false !== strpos('0123456789.eE+-', $json[$j])) {
                    ++$j;
                }
                $token = substr($json, $i, $j - $i);
                $out .= 1 === preg_match('/[.eE]/', $token) ? "\"{$token}\"" : $token;
                $i = $j;
            } else {
                $out .= $ch;
                ++$i;
            }
        }
        try {
            return json_decode($out, true, 512, \JSON_THROW_ON_ERROR | \JSON_BIGINT_AS_STRING);
        } catch (\JsonException) {
            return null;
        }
    }

    // ------------------------------------------------------------------ exact decimals

    /**
     * A non-negative amount as [digits, exponent] (value = digits × 10^exponent), or null when it isn't one.
     * Floats go through their shortest round-trip text, so `1500.25` stays `1500.25`.
     *
     * @return array{0: string, 1: int}|null
     */
    private static function decimal(mixed $v): ?array
    {
        if (\is_int($v)) {
            return $v < 0 ? null : [(string) $v, 0];
        }
        if (\is_float($v)) {
            if (!is_finite($v) || $v < 0) {
                return null;
            }
            $text = '';
            for ($p = 0; $p <= 16; ++$p) {
                $text = \sprintf("%.{$p}e", $v);
                if ((float) $text === $v) {
                    break;
                }
            }
            $v = $text;
        }
        if (!\is_string($v) || 1 !== preg_match('/^\+?([0-9]*)(?:\.([0-9]*))?(?:[eE]([+-]?[0-9]{1,6}))?$/D', trim($v), $m) || '' === $m[1] . ($m[2] ?? '')) {
            return null;
        }

        return [$m[1] . ($m[2] ?? ''), (int) ($m[3] ?? 0) - \strlen($m[2] ?? '')];
    }

    /**
     * @param array{0: string, 1: int}|null $d
     *
     * @return array{0: string, 1: int}|null
     */
    private static function shift(?array $d, int $by): ?array
    {
        return null === $d ? null : [$d[0], $d[1] + $by];
    }

    /** @param array{0: string, 1: int} $d the shortest plain decimal: no exponent, no trailing fractional zeros */
    private static function format(array $d): string
    {
        [$digits, $exp] = $d;
        $digits = ltrim($digits, '0');
        if ('' === $digits) {
            return '0';
        }
        while ($exp < 0 && str_ends_with($digits, '0')) {
            $digits = substr($digits, 0, -1);
            ++$exp;
        }
        if ($exp >= 0) {
            return $digits . str_repeat('0', $exp);
        }
        $digits = str_pad($digits, -$exp + 1, '0', \STR_PAD_LEFT);

        return substr($digits, 0, $exp) . '.' . substr($digits, $exp);
    }

    // ------------------------------------------------------------------ times

    /** Unix seconds (milliseconds above 10^11) or an ISO 8601 string, as RFC 3339 UTC; else null. */
    private static function time(mixed $v): ?string
    {
        if (\is_int($v) || \is_float($v)) {
            if (!is_finite((float) $v)) {
                return null;
            }
            $ms = (int) floor($v > 1e11 ? $v : $v * 1000);

            return self::utc(intdiv($ms, 1000) - ($ms % 1000 < 0 ? 1 : 0), (($ms % 1000) + 1000) % 1000);
        }
        if (!\is_string($v) || 1 !== preg_match('/^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?([Zz]|[+-]\d{2}:?\d{2})?$/D', trim($v), $m)) {
            return null;
        }
        [$y, $mo, $d, $h, $mi, $s] = [(int) $m[1], (int) $m[2], (int) $m[3], (int) $m[4], (int) $m[5], (int) ($m[6] ?? 0)];
        if (!checkdate($mo, $d, $y) || $h > 23 || $mi > 59 || $s > 59) {
            return null;
        }
        $offset = 0;
        $zone = $m[8] ?? '';
        if ('' !== $zone && 'z' !== strtolower($zone)) {
            $z = str_replace(':', '', $zone);
            $offset = ('-' === $z[0] ? -1 : 1) * ((int) substr($z, 1, 2) * 3600 + (int) substr($z, 3, 2) * 60);
        }
        $ms = (int) substr(str_pad($m[7] ?? '', 3, '0'), 0, 3);

        return self::utc(gmmktime($h, $mi, $s, $mo, $d, $y) - $offset, $ms);
    }

    private static function utc(int $seconds, int $ms): string
    {
        return gmdate('Y-m-d\TH:i:s', $seconds) . ($ms > 0 ? \sprintf('.%03dZ', $ms) : 'Z');
    }
}
