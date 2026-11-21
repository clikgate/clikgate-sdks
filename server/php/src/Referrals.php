<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Exception\ErrorMapper;
use Clikgate\Exception\InvalidRequestException;
use Clikgate\Exception\NotFoundException;
use Clikgate\Http\ApiRequest;
use Clikgate\Http\Requester;
use Clikgate\Model\Job;
use Clikgate\Model\Page;
use Clikgate\Model\Referral;
use Clikgate\Model\Referrer;

/**
 * Referrals: referrers, referrals, manual overrides, qualification steps and imports (SPEC section 28). Every
 * method returns a typed model.
 *
 * @phpstan-type ReferralListParams array{programId?: ?string, referrerId?: ?string, refereeCustomerId?: ?string, status?: ?string, from?: \DateTimeInterface|string|null, to?: \DateTimeInterface|string|null, limit?: ?int, startingAfter?: ?string, endingBefore?: ?string}
 */
final class Referrals
{
    /** The API's limit of referrers per import request; `importReferrers()` splits larger lists. */
    public const IMPORT_BATCH = 1000;

    /** @internal */
    public function __construct(private readonly Core $core) {}

    /**
     * Get the referrer for one of your customers in a program, creating it (with its code and link) the first
     * time. `$referrer->created` is true when it was just created.
     *
     * - `code`: your own exact Clikgate code for a new referrer instead of a generated one (3-32 letters, digits, `-` or `_`,
     *   unique in your organisation; a `ConflictException` with code `code_taken` otherwise). Applied only when the
     *   referrer is created; an existing referrer keeps theirs.
     * - `externalCode`: an extra code from an older referral system that keeps working alongside the Clikgate code.
     *
     * ```php
     * $referrer = $clikgate->referrals->getOrCreateReferrer('rpg_01J…', ['customerId' => (string) $user->id, 'displayName' => $user->first_name]);
     * echo $referrer->code, ' ', $referrer->url;
     * ```
     *
     * @param array{customerId: string, displayName?: ?string, code?: ?string, externalCode?: ?string} $params
     * @param array<string, mixed>                                                                      $requestOptions
     */
    public function getOrCreateReferrer(string $programId, array $params, array $requestOptions = []): Referrer
    {
        $path = '/v1/referral-programs/' . self::id($programId, 'program_id') . '/referrers';
        $body = self::defined([
            'customer_user_id' => Requester::requireId($params['customerId'], 'customer_id'),
            'display_name' => $params['displayName'] ?? null,
            'code' => $params['code'] ?? null,
            'external_code' => $params['externalCode'] ?? null,
        ]);
        [$status, $data] = $this->core->requester->request((new ApiRequest('POST', $path))->withBody($body)->withOptions($requestOptions));

        return new Referrer(Links::arr($data), 201 === $status);
    }

    /**
     * Fetch a referrer by ID.
     *
     * ```php
     * $referrer = $clikgate->referrals->getReferrer('rfr_01J…');
     * ```
     *
     * @param array<string, mixed> $requestOptions
     */
    public function getReferrer(string $referrerId, array $requestOptions = []): Referrer
    {
        return new Referrer($this->call('GET', '/v1/referrers/' . self::id($referrerId, 'referrer_id'), null, $requestOptions));
    }

    /**
     * Find a referrer by your customer ID or by code (exactly one). Null when there is none (404); other errors throw.
     *
     * ```php
     * $referrer = $clikgate->referrals->findReferrer('rpg_01J…', ['customerId' => (string) $user->id]);
     * ```
     *
     * @param array{customerId?: ?string, code?: ?string} $lookup
     * @param array<string, mixed>                       $requestOptions
     */
    public function findReferrer(string $programId, array $lookup, array $requestOptions = []): ?Referrer
    {
        $program = self::id($programId, 'program_id');
        $customerId = $lookup['customerId'] ?? null;
        $code = $lookup['code'] ?? null;
        if ((null === $customerId) === (null === $code)) {
            throw ErrorMapper::local('invalid_argument', 'Pass exactly one of customerId and code.', 'customer_id');
        }
        $path = null !== $customerId
            ? "/v1/referral-programs/{$program}/referrers/by-user/" . self::id($customerId, 'customer_id')
            : "/v1/referral-programs/{$program}/referrers/by-code/" . self::id($code, 'code');
        try {
            return new Referrer($this->call('GET', $path, null, $requestOptions));
        } catch (NotFoundException) {
            return null;
        }
    }

    /**
     * Fetch a referral by ID. Reward sides carry `amount` (normal units) next to `amountMinor`.
     *
     * ```php
     * $referral = $clikgate->referrals->get('ref_01J…');
     * echo $referral->status, ' ', $referral->reward?->referrer?->amount;
     * ```
     *
     * @param array<string, mixed> $requestOptions
     */
    public function get(string $referralId, array $requestOptions = []): Referral
    {
        return new Referral($this->call('GET', '/v1/referrals/' . self::id($referralId, 'referral_id'), null, $requestOptions));
    }

    /**
     * Fetch one page of referrals.
     *
     * ```php
     * $page = $clikgate->referrals->listPage(['programId' => 'rpg_01J…', 'status' => 'qualified', 'limit' => 100]);
     * ```
     *
     * @param ReferralListParams   $params
     * @param array<string, mixed> $requestOptions
     *
     * @return Page<Referral>
     */
    public function listPage(array $params = [], array $requestOptions = []): Page
    {
        $query = self::defined([
            'program_id' => $params['programId'] ?? null,
            'referrer_id' => $params['referrerId'] ?? null,
            'referee_customer_user_id' => $params['refereeCustomerId'] ?? null,
            'status' => $params['status'] ?? null,
            'from' => $params['from'] ?? null,
            'to' => $params['to'] ?? null,
            'limit' => $params['limit'] ?? null,
            'starting_after' => $params['startingAfter'] ?? null,
            'ending_before' => $params['endingBefore'] ?? null,
        ]);
        [, $data] = $this->core->requester->request((new ApiRequest('GET', '/v1/referrals', $query))->withOptions($requestOptions));

        return new Page(Links::arr($data), static fn(array $r): Referral => new Referral($r));
    }

    /**
     * Iterate over every referral, fetching pages lazily.
     *
     * ```php
     * foreach ($clikgate->referrals->list(['programId' => 'rpg_01J…', 'status' => 'qualified']) as $referral) {
     *     echo $referral->id, ' ', $referral->referee->customerId, "\n";
     * }
     * ```
     *
     * @param ReferralListParams   $params
     * @param array<string, mixed> $requestOptions
     *
     * @return \Generator<int, Referral>
     */
    public function list(array $params = [], array $requestOptions = []): \Generator
    {
        $cursor = null;
        while (true) {
            $page = $this->listPage(null === $cursor ? $params : ['startingAfter' => $cursor] + $params, $requestOptions);
            yield from $page->data;
            if (!$page->hasMore || null === $page->nextCursor || '' === $page->nextCursor) {
                return;
            }
            $cursor = $page->nextCursor;
        }
    }

    /**
     * Qualify a referral by hand (a manual override), with your reason.
     *
     * ```php
     * $clikgate->referrals->qualify('ref_01J…', ['reason' => 'Checked by support']);
     * ```
     *
     * @param array{reason: string} $params
     * @param array<string, mixed>  $requestOptions
     */
    public function qualify(string $referralId, array $params, array $requestOptions = []): Referral
    {
        return $this->override($referralId, 'qualify', $params['reason'], $requestOptions);
    }

    /**
     * Disqualify a referral by hand (a manual override), with your reason.
     *
     * ```php
     * $clikgate->referrals->disqualify('ref_01J…', ['reason' => 'Same household']);
     * ```
     *
     * @param array{reason: string} $params
     * @param array<string, mixed>  $requestOptions
     */
    public function disqualify(string $referralId, array $params, array $requestOptions = []): Referral
    {
        return $this->override($referralId, 'disqualify', $params['reason'], $requestOptions);
    }

    /**
     * Complete the referral's current qualification step from your server. `occurredAt` (when it happened) is required.
     *
     * ```php
     * $clikgate->referrals->completeStep('ref_01J…', ['goal' => 'first_order', 'occurredAt' => $order->paidAt, 'value' => '1500.50', 'currency' => 'NGN']);
     * ```
     *
     * @param array{goal: string, occurredAt: \DateTimeInterface|string, value?: string|int|null, currency?: ?string} $params
     * @param array<string, mixed>                                                                                            $requestOptions
     */
    public function completeStep(string $referralId, array $params, array $requestOptions = []): Referral
    {
        $path = '/v1/referrals/' . self::id($referralId, 'referral_id') . '/steps';
        $value = $params['value'] ?? null;
        $occurredAt = self::field($params, 'occurredAt');   // required, but checked at runtime for callers without phpstan
        if (!$occurredAt instanceof \DateTimeInterface && (!\is_string($occurredAt) || '' === $occurredAt)) {
            throw new InvalidRequestException('occurredAt is required: when the step happened.', 'invalid_argument', param: 'occurred_at');
        }
        $body = self::defined([
            'goal' => $params['goal'],
            'occurred_at' => Requester::formatDate($occurredAt),
            'value' => null === $value ? null : Money::formatValue($value),
            'currency' => $params['currency'] ?? null,
        ]);

        return new Referral($this->call('POST', $path, $body, $requestOptions));
    }

    /**
     * Import referrers (customers who already refer others, with their old codes), in batches of 1000. Returns one
     * job per batch.
     *
     * ```php
     * $jobs = $clikgate->referrals->importReferrers('rpg_01J…', [['customerId' => 'user-42', 'externalCode' => 'ADA-OLD']]);
     * ```
     *
     * @param iterable<array{customerId: string, externalCode?: ?string, displayName?: ?string}> $rows
     * @param array<string, mixed>                                                               $requestOptions
     *
     * @return list<Job>
     */
    public function importReferrers(string $programId, iterable $rows, array $requestOptions = []): array
    {
        $path = '/v1/referral-programs/' . self::id($programId, 'program_id') . '/referrers/import';
        $wire = [];
        $i = 0;
        foreach ($rows as $row) {
            $wire[] = self::defined([
                'customer_user_id' => Requester::requireId($row['customerId'], "rows[{$i}].customer_id"),
                'external_code' => $row['externalCode'] ?? null,
                'display_name' => $row['displayName'] ?? null,
            ]);
            ++$i;
        }
        $jobs = [];
        $several = \count($wire) > self::IMPORT_BATCH;
        foreach (array_chunk($wire, self::IMPORT_BATCH) as $n => $chunk) {
            $options = $requestOptions;
            if ($several && isset($options['idempotencyKey']) && \is_string($options['idempotencyKey'])) {
                $options['idempotencyKey'] .= '-' . $n;
            }
            $jobs[] = new Job($this->call('POST', $path, ['referrers' => $chunk], $options));
        }

        return $jobs;
    }

    /**
     * Block a referrer: their code and link stop creating referrals.
     *
     * ```php
     * $clikgate->referrals->blockReferrer('rfr_01J…', ['reason' => 'Fake installs']);
     * ```
     *
     * @param array{reason?: ?string} $params
     * @param array<string, mixed>    $requestOptions
     */
    public function blockReferrer(string $referrerId, array $params = [], array $requestOptions = []): Referrer
    {
        $path = '/v1/referrers/' . self::id($referrerId, 'referrer_id') . '/block';

        return new Referrer($this->call('POST', $path, self::defined(['reason' => $params['reason'] ?? null]), $requestOptions));
    }

    /**
     * Unblock a referrer.
     *
     * ```php
     * $clikgate->referrals->unblockReferrer('rfr_01J…');
     * ```
     *
     * @param array<string, mixed> $requestOptions
     */
    public function unblockReferrer(string $referrerId, array $requestOptions = []): Referrer
    {
        return new Referrer($this->call('POST', '/v1/referrers/' . self::id($referrerId, 'referrer_id') . '/unblock', null, $requestOptions));
    }

    /**
     * Update a referrer's display name, `externalCode` or your own attributes (`null` clears).
     * `externalCode` replaces the extra code from an older referral system; the Clikgate `code` can't be changed.
     *
     * ```php
     * $clikgate->referrals->updateReferrer('rfr_01J…', ['displayName' => 'Ada O.', 'attributes' => ['tier' => 'gold']]);
     * ```
     *
     * @param array{displayName?: ?string, externalCode?: ?string, attributes?: ?array<string, mixed>} $params
     * @param array<string, mixed>                                                                    $requestOptions
     */
    public function updateReferrer(string $referrerId, array $params, array $requestOptions = []): Referrer
    {
        $body = [];
        foreach (['displayName' => 'display_name', 'externalCode' => 'external_code', 'attributes' => 'attributes'] as $option => $wire) {
            if (\array_key_exists($option, $params)) {
                $body[$wire] = $params[$option];
            }
        }

        return new Referrer($this->call('PATCH', '/v1/referrers/' . self::id($referrerId, 'referrer_id'), $body, $requestOptions));
    }

    /** @param array<string, mixed> $requestOptions */
    private function override(string $referralId, string $action, string $reason, array $requestOptions): Referral
    {
        $path = '/v1/referrals/' . self::id($referralId, 'referral_id') . '/override';

        return new Referral($this->call('POST', $path, ['action' => $action, 'reason' => $reason], $requestOptions));
    }

    /**
     * @param array<string, mixed>|null $body null: no body
     * @param array<string, mixed>      $requestOptions
     *
     * @return array<string, mixed>
     */
    private function call(string $method, string $path, ?array $body, array $requestOptions): array
    {
        $req = new ApiRequest($method, $path);
        if (null !== $body) {
            $req->withBody($body);
        }
        [, $data] = $this->core->requester->request($req->withOptions($requestOptions));

        return Links::arr($data);
    }

    /** @internal Encode a required path segment. */
    public static function id(mixed $value, string $name): string
    {
        return Requester::encodePathSegment(Requester::requireId($value, $name));
    }

    /**
     * @internal Drop null values.
     *
     * @param array<string, mixed> $values
     *
     * @return array<string, mixed>
     */
    public static function defined(array $values): array
    {
        return array_filter($values, static fn(mixed $v): bool => null !== $v);
    }

    /**
     * @param array<string, mixed> $params
     */
    private static function field(array $params, string $key): mixed
    {
        return $params[$key] ?? null;
    }
}
