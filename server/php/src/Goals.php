<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Enum\Provider;
use Clikgate\Exception\ClikgateException;
use Clikgate\Exception\ErrorMapper;
use Clikgate\Exception\InvalidRequestException;
use Clikgate\Http\ApiRequest;
use Clikgate\Http\Requester;

/**
 * Goal events: the outcomes your business cares about (`account_opened`, `loan_disbursed`, `order_paid`).
 * `goals->send()` waits for the API and throws on failure; `$clikgate->goal()` never throws.
 *
 * Goal options (all optional except `reference`): `reference` (your own unique ID, 1-128 characters),
 * `clickId`, `code` (an offline or creator code, instead of a click ID), `value` (normal units, a decimal
 * string or an int), `currency`, `isFirst`, `label` (the person's label, 1-80 characters; Growth and up), `occurredAt` (`DateTimeInterface` or an RFC 3339 string),
 * `metadata` (refused in private mode), `consent` (allowed), `provider` (a `Provider`, or a provider-key string for a
 * gateway newer than this release; the gateway of a Payment goal), `keptBy`, `browserEngine` and `platform` (the
 * visitor context from `clickIds->context()`; allowed in private mode), `hashedEmail`, `hashedPhoneE164` and
 * `hashedPhoneDigits` (your own SHA-256 hashes for ad network matching, 64 lowercase hex; make them with
 * `HashForAds::hash()`; allowed in private mode), `extra` (additional wire fields).
 *
 * Results are the wire JSON as arrays. `status` is a `GoalStatus` value (`counted`, `waiting` or `refused`, with
 * `reason`): read it with `GoalStatus::tryFrom($event['status'])`, which gives null for a status this release
 * doesn't know. `goal_kind` is a `GoalKind` value; `event_status` is the conversion state (`attributed`, …).
 *
 * @phpstan-type GoalOptions array{reference?: string, clickId?: ?string, code?: ?string, value?: string|int|null, currency?: ?string, isFirst?: ?bool, label?: ?string, occurredAt?: \DateTimeInterface|string|null, metadata?: ?array<string, mixed>, consent?: ?array<string, mixed>, provider?: Provider|string|null, keptBy?: ?string, browserEngine?: ?string, platform?: ?string, hashedEmail?: ?string, hashedPhoneE164?: ?string, hashedPhoneDigits?: ?string, extra?: ?array<string, mixed>}
 */
final class Goals
{
    private const OPTIONS = ['reference' => 'reference', 'clickId' => 'click_id', 'code' => 'code', 'value' => 'value', 'currency' => 'currency', 'isFirst' => 'is_first', 'label' => 'label', 'occurredAt' => 'occurred_at', 'metadata' => 'metadata', 'consent' => 'consent', 'extra' => 'extra', 'provider' => 'provider', 'keptBy' => 'kept_by', 'browserEngine' => 'browser_engine', 'platform' => 'platform', 'hashedEmail' => 'hashed_email', 'hashedPhoneE164' => 'hashed_phone_e164', 'hashedPhoneDigits' => 'hashed_phone_digits'];
    /** The visitor context values (SPEC 9.1, 13.1), from `clickIds->context()`. */
    public const KEPT_BY = ['server_cookie', 'script_cookie', 'form', 'payment_metadata', 'unknown'];
    public const BROWSER_ENGINES = ['webkit_ios', 'safari_mac', 'chromium', 'gecko', 'other'];
    public const PLATFORMS = ['ios', 'android', 'macos', 'windows', 'linux', 'other'];

    /** @internal */
    public function __construct(private readonly Core $core) {}

    /**
     * @internal Validate goal options and build the wire object (SPEC 9.1 step 1).
     *
     * @param array<string, mixed> $options
     *
     * @return array<string, mixed>
     */
    public static function wire(mixed $key, array $options): array
    {
        $goal = self::checkKey($key);
        foreach (array_keys($options) as $k) {
            if (!isset(self::OPTIONS[$k])) {
                throw ErrorMapper::local('invalid_argument', \sprintf('Unknown goal option "%s". Options: %s.', $k, implode(', ', array_keys(self::OPTIONS))), (string) $k);
            }
        }
        $reference = self::checkReference($options['reference'] ?? null);
        $clickId = $options['clickId'] ?? null;
        $code = $options['code'] ?? null;
        if (null !== $clickId && null !== $code) {
            throw ErrorMapper::local('click_id_and_code', 'Send either clickId or code, not both.', 'code');
        }
        $provider = $options['provider'] ?? null;
        if ($provider instanceof Provider) {
            $provider = $provider->value;
        }
        if (null !== $provider && (!\is_string($provider) || 1 !== preg_match('/^[a-z][a-z0-9_]{1,29}$/D', $provider))) {
            throw ErrorMapper::local('invalid_provider', 'provider must be a provider key such as "paystack" or "stripe" (lower case).', 'provider');
        }
        $context = [];
        foreach (['keptBy' => ['kept_by', self::KEPT_BY], 'browserEngine' => ['browser_engine', self::BROWSER_ENGINES], 'platform' => ['platform', self::PLATFORMS]] as $option => [$field, $allowed]) {
            $v = $options[$option] ?? null;
            if (null !== $v && !\in_array($v, $allowed, true)) {
                throw ErrorMapper::local('invalid_argument', \sprintf('%s must be one of %s.', $option, implode(', ', $allowed)), $field);
            }
            $context[$field] = $v;
        }
        foreach (HashForAds::FIELDS as $option => $field) {
            $context[$field] = $options[$option] ?? null;
        }
        $occurred = $options['occurredAt'] ?? null;
        if (null !== $occurred && !\is_string($occurred) && !$occurred instanceof \DateTimeInterface) {
            throw ErrorMapper::local('invalid_argument', 'occurredAt must be a DateTimeInterface or an RFC 3339 string.', 'occurred_at');
        }
        $wire = [
            'goal' => $goal,
            'reference' => $reference,
            'click_id' => $clickId,
            'code' => $code,
            'value' => isset($options['value']) ? Money::formatValue($options['value']) : null,
            'currency' => $options['currency'] ?? null,
            'is_first' => $options['isFirst'] ?? null,
            'label' => $options['label'] ?? null,
            'provider' => $provider,
            'occurred_at' => null === $occurred ? null : Requester::formatDate($occurred),
            'metadata' => $options['metadata'] ?? null,
            'consent' => $options['consent'] ?? null,
        ] + $context;
        $extra = $options['extra'] ?? null;
        if (\is_array($extra)) {
            foreach ($extra as $k => $v) {
                $wire[(string) $k] = $v;
            }
        }

        HashForAds::checkFields($wire);

        return array_filter($wire, static fn(mixed $v): bool => null !== $v);
    }

    private static function checkKey(mixed $key): string
    {
        if (!\is_string($key) || 1 !== preg_match('/^[a-z][a-z0-9_]{1,39}$/D', $key)) {
            throw ErrorMapper::local('invalid_goal_key', 'Goal keys are snake_case, 2-40 characters, starting with a letter (e.g. "account_opened").', 'goal');
        }

        return $key;
    }

    private static function checkReference(mixed $reference): string
    {
        if (!\is_string($reference) || '' === $reference || mb_strlen($reference) > 128) {
            throw ErrorMapper::local('invalid_reference', 'reference is required: your own unique ID for this event, 1-128 characters.', 'reference');
        }

        return $reference;
    }

    /**
     * @internal Config-based warnings (SPEC 12.3, warn-only) and the guard (12.2).
     *
     * @param array{0: bool, 1: array<string, mixed>|null} $state
     * @param array<string, mixed>                          $wire
     */
    public static function checkBeforeSend(Core $core, array $state, array $wire): void
    {
        [$guard, $config] = $state;
        if (null !== $config && 'auto' === $core->privateMode) {
            $goal = null;
            foreach (\is_array($config['goals'] ?? null) ? $config['goals'] : [] as $g) {
                if (\is_array($g) && ($g['key'] ?? null) === $wire['goal']) {
                    $goal = $g;
                    break;
                }
            }
            $key = self::str($wire['goal'] ?? null);
            if (null === $goal) {
                $core->warn('unknown_goal', "The goal \"{$key}\" isn't defined for your organisation (it will be sent; the API decides).", $key);
            } else {
                if ('none' === ($goal['value_mode'] ?? null) && isset($wire['value'])) {
                    $core->warn('value_not_allowed', "The goal \"{$key}\" takes no value.", $key);
                }
                if ('required' === ($goal['value_mode'] ?? null) && !isset($wire['value'])) {
                    $core->warn('value_required', "The goal \"{$key}\" needs a value.", $key);
                }
            }
        }
        if ($guard) {
            Guard::check('goal', $wire);
        }
    }

    /**
     * @internal `POST /v1/goals/events` for one checked wire event; notes an `unknown_goal` refusal (debug line).
     *
     * @param array<string, mixed> $wire
     * @param array<string, mixed> $requestOptions
     *
     * @return array{0: int, 1: mixed, 2: array<string, string>}
     */
    public function sendWire(array $wire, array $requestOptions = []): array
    {
        try {
            $answer = $this->core->requester->request(self::sendRequest($wire, $requestOptions));
        } catch (ClikgateException $e) {
            $this->core->noteRefusedGoal($wire['goal'] ?? null, $e->getErrorCode());

            throw $e;
        }
        $this->core->noteRefusedGoal($wire['goal'] ?? null, \is_array($answer[1]) ? ($answer[1]['reason'] ?? null) : null);

        return $answer;
    }

    /**
     * @internal
     *
     * @param array<string, mixed> $wire
     * @param array<string, mixed> $requestOptions
     */
    public static function sendRequest(array $wire, array $requestOptions = []): ApiRequest
    {
        // A random Idempotency-Key per call (the requester's default), reused across its retries.
        return (new ApiRequest('POST', '/v1/goals/events'))->withBody($wire)->withOptions($requestOptions);
    }

    /**
     * Send one goal event and wait for the result. Retries are safe: each call sends a random
     * `Idempotency-Key`, reused across its retries, and the API ignores a second event with the same
     * goal and reference, so a resend never counts twice.
     *
     * ```php
     * $event = $clikgate->goals->send('account_opened', [
     *     'clickId' => $application->click_id,   // kept since the visitor landed
     *     'reference' => 'APP-55231',
     *     'value' => '2000000',                  // ₦2,000,000 in normal units, as a string
     *     'currency' => 'NGN',
     * ]);
     * if (GoalStatus::Counted === GoalStatus::tryFrom($event['status'])) { echo 'attributed to ', $event['attributed_to']['link_id'] ?? '-'; }
     * ```
     *
     * @param array<string, mixed> $options        goal options (see the class doc)
     * @param array<string, mixed> $requestOptions `idempotencyKey`, `timeout` (seconds), `maxRetries`
     *
     * @return array<string, mixed> the goal event
     *
     * @throws InvalidRequestException local validation or a 4xx (PrivateModeFieldRejectedException in private mode)
     */
    public function send(string $key, array $options, array $requestOptions = []): array
    {
        $wire = self::wire($key, $options);
        self::checkBeforeSend($this->core, $this->core->guardState(), $wire);
        [, $data] = $this->sendWire($wire, $requestOptions);

        return self::arr($data);
    }

    /**
     * Send up to 500 goal events in one request. Per-event failures are returned, not thrown.
     *
     * ```php
     * $result = $clikgate->goals->sendBatch([
     *     ['goal' => 'order_paid', 'reference' => 'ORD-1001', 'clickId' => $clickId, 'value' => '1500.50', 'currency' => 'NGN'],
     *     ['goal' => 'order_paid', 'reference' => 'ORD-1002', 'value' => '99.90'],
     * ]);
     * foreach ($result['data'] as $item) { if (!$item['ok']) { echo $item['index'], ' ', $item['error']['code']; } }
     * ```
     *
     * @param list<array<string, mixed>> $events each is `['goal' => key] + goal options`
     * @param array<string, mixed>       $requestOptions
     *
     * @return array<string, mixed> `{object: "list", data: [{index, ok, status, goal_event|error}]}`
     */
    public function sendBatch(array $events, array $requestOptions = []): array
    {
        if ([] === $events) {
            throw ErrorMapper::local('batch_empty', 'Send at least one event.', 'events');
        }
        if (\count($events) > 500) {
            throw ErrorMapper::local('batch_too_large', 'A batch takes at most 500 events.', 'events');
        }
        $wires = [];
        foreach ($events as $i => $e) {
            try {
                $goal = $e['goal'] ?? null;
                unset($e['goal']);
                $wires[] = self::wire($goal, $e);
            } catch (InvalidRequestException $err) {
                throw $err->withIndex($i);
            }
        }
        $state = $this->core->guardState();
        foreach ($wires as $i => $w) {
            try {
                self::checkBeforeSend($this->core, $state, $w);
            } catch (InvalidRequestException $err) {
                throw $err->withIndex($i);
            }
        }
        [, $data] = $this->core->requester->request((new ApiRequest('POST', '/v1/goals/events/batch'))->withBody(['events' => $wires])->withOptions($requestOptions));
        $this->core->noteRefusedItems($wires, $data);

        return self::arr($data);
    }

    /**
     * Reverse a goal event, fully (no value) or partly (a refund, a cancelled loan, a chargeback).
     *
     * ```php
     * $clikgate->goals->reverse('loan_disbursed', 'LN-2201');                 // full
     * $clikgate->goals->reverse('order_paid', 'ORD-1001', ['value' => '500']); // partial
     * ```
     *
     * @param array{value?: string|int|null, reason?: ?string} $options
     * @param array<string, mixed>                             $requestOptions
     *
     * @return array<string, mixed> the goal event
     */
    public function reverse(string $key, string $reference, array $options = [], array $requestOptions = []): array
    {
        $wire = ['goal' => self::checkKey($key), 'reference' => self::checkReference($reference)];
        if (isset($options['value'])) {
            $wire['value'] = Money::formatValue($options['value']);
        }
        if (isset($options['reason'])) {
            $wire['reason'] = $options['reason'];
        }
        if ($this->core->guardState()[0]) {
            Guard::check('reversal', $wire);
        }
        [, $data] = $this->core->requester->request((new ApiRequest('POST', '/v1/goals/events/reverse'))->withBody($wire)->withOptions($requestOptions));

        return self::arr($data);
    }

    private static function str(mixed $v): string
    {
        return \is_string($v) ? $v : '';
    }

    /** @return array<string, mixed> */
    private static function arr(mixed $data): array
    {
        /** @var array<string, mixed> */
        return \is_array($data) ? $data : [];
    }
}
