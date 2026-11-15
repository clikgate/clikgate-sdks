<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Exception\ConflictException;
use Clikgate\Exception\ErrorMapper;
use Clikgate\Http\ApiRequest;

/**
 * Known customers: people who were already your customers before you added Clikgate. Clikgate uses
 * them so an existing customer is never counted as a referral or a new customer. It stores a keyed fingerprint of
 * each ID, not the ID itself. Not available in private mode. Scope `people:write`.
 */
final class KnownCustomers
{
    /** The API's batch size; `import()` splits larger lists. */
    public const BATCH = 10_000;

    /** @internal */
    public function __construct(private readonly Core $core) {}

    /**
     * Import existing customers (`POST /v1/known-customers/import`), in batches of 10,000. Idempotent per customer
     * ID. Use your own customer IDs, never emails or phone numbers. Refused rows are counted by reason, never returned.
     *
     * ```php
     * $result = $clikgate->knownCustomers->import([['customerId' => 'u_10482', 'customerSince' => '2024-03-02']]);
     * echo $result['accepted'];
     * ```
     *
     * @param iterable<array{customerId: string, customerSince?: string|\DateTimeInterface|int|null}> $customers
     * @param array<string, mixed>                                                                   $requestOptions
     *
     * @return array{accepted: int, refused: int, refused_by_reason: array<string, int>}
     */
    public function import(iterable $customers, array $requestOptions = []): array
    {
        $rows = [];
        $i = 0;
        foreach ($customers as $c) {
            $rows[] = self::row($c, $i++);
        }
        $total = ['accepted' => 0, 'refused' => 0, 'refused_by_reason' => []];
        if ([] === $rows) {
            return $total;
        }
        if ($this->core->guardState()[0]) {
            throw self::privateModeConflict();
        }
        $several = \count($rows) > self::BATCH;
        foreach (array_chunk($rows, self::BATCH) as $n => $chunk) {
            $options = $requestOptions;
            if ($several && isset($options['idempotencyKey']) && \is_string($options['idempotencyKey'])) {
                // One idempotency key per batch: a key you pass gets the batch number appended
                $options['idempotencyKey'] .= '-' . $n;
            }
            [, $data] = $this->core->requester->request((new ApiRequest('POST', '/v1/known-customers/import'))->withBody(['customers' => $chunk])->withOptions($options));
            $data = Links::arr($data);
            $total['accepted'] += self::count($data['accepted'] ?? 0);
            $total['refused'] += self::count($data['refused'] ?? 0);
            $reasons = $data['refused_by_reason'] ?? [];
            foreach (\is_array($reasons) ? $reasons : [] as $reason => $count) {
                $total['refused_by_reason'][(string) $reason] = ($total['refused_by_reason'][(string) $reason] ?? 0) + self::count($count);
            }
        }

        return $total;
    }

    /**
     * Remove one imported customer (`POST /v1/known-customers/remove`; the ID travels in the body, never in a URL).
     *
     * ```php
     * $clikgate->knownCustomers->remove('u_10482'); // ['removed' => true]
     * ```
     *
     * @param array<string, mixed> $requestOptions
     *
     * @return array<string, mixed>
     */
    public function remove(string $customerId, array $requestOptions = []): array
    {
        if ('' === $customerId) {
            throw ErrorMapper::local('invalid_customer_id', 'customerId must be a non-empty string.', 'customer_id');
        }
        if ($this->core->guardState()[0]) {
            throw self::privateModeConflict();
        }
        [, $data] = $this->core->requester->request((new ApiRequest('POST', '/v1/known-customers/remove'))->withBody(['customer_id' => $customerId])->withOptions($requestOptions));

        return Links::arr($data);
    }

    /** @return array{customer_id: string, customer_since?: string} */
    private static function row(mixed $c, int $i): array
    {
        if (!\is_array($c) || !isset($c['customerId']) || !\is_string($c['customerId'])) {
            throw ErrorMapper::local('invalid_argument', \sprintf('customers[%d][customerId] must be a string.', $i), 'customer_id');
        }
        $row = ['customer_id' => $c['customerId']];
        if (null !== ($c['customerSince'] ?? null)) {
            $row['customer_since'] = self::day($c['customerSince']);
        }

        return $row;
    }

    private static function count(mixed $n): int
    {
        return \is_int($n) ? $n : (is_numeric($n) ? (int) $n : 0);
    }

    /** @internal The UTC day of a customerSince value. */
    public static function day(mixed $value): string
    {
        if (\is_string($value) && 1 === preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) {
            return $value;
        }
        if ($value instanceof \DateTimeInterface) {
            return \DateTimeImmutable::createFromInterface($value)->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d');
        }
        if (\is_int($value)) {
            return gmdate('Y-m-d', $value);
        }

        throw ErrorMapper::local('invalid_argument', "customerSince must be 'YYYY-MM-DD', a DateTimeInterface or Unix seconds.", 'customer_since');
    }

    private static function privateModeConflict(): ConflictException
    {
        return new ConflictException("Private mode is on: known customers can't be imported or removed.", 'private_mode_conflict');
    }
}
