<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Exception\PrivateModeFieldRejectedException;

/** @internal The private-mode guard (SPEC 12.2): refuse every non-allowed field before the HTTP layer sees it. */
final class Guard
{
    private const GOAL = ['goal', 'click_id', 'code', 'reference', 'value', 'currency', 'is_first', 'occurred_at', 'consent', 'provider', 'kept_by', 'browser_engine', 'platform',
        // SPEC 25: the API accepts them in private mode only while a destination matches by hashed email or phone
        'hashed_email', 'hashed_phone_e164', 'hashed_phone_digits'];
    public const REDACTED = '[redacted]';

    /** @return list<string> */
    public static function allowed(string $kind): array
    {
        return match ($kind) {
            // `label`: the API accepts it in private mode only with "Allow labels in private mode" (SPEC 24)
            'goal' => [...self::GOAL, 'label'],
            'conversion' => [...self::GOAL, 'external_id'],
            'identify' => ['click_id', 'app_id', 'installation_id', 'label'],
            'payment_confirmation' => ['provider', 'reference', 'status', 'amount', 'amount_minor', 'currency', 'occurred_at', 'aliases', 'click_id', 'goal', 'test', 'refund_id', 'source_plugin'],
            default => ['goal', 'reference', 'value', 'external_id', 'amount_minor'],
        };
    }

    /**
     * Throw for the first refused (non-null) wire field: `metadata`, then `consent`, then the rest alphabetically.
     *
     * @param array<string, mixed> $wire
     */
    public static function check(string $kind, array $wire): void
    {
        $allowed = self::allowed($kind);
        $refused = [];
        foreach ($wire as $k => $v) {
            if (null !== $v && !\in_array((string) $k, $allowed, true)) {
                $refused[] = (string) $k;
            }
        }
        if ([] === $refused) {
            return;
        }
        $rank = static fn(string $k): int => 'metadata' === $k ? 0 : ('consent' === $k ? 1 : 2);
        usort($refused, static fn(string $a, string $b): int => [$rank($a), $a] <=> [$rank($b), $b]);
        $field = $refused[0];
        throw new PrivateModeFieldRejectedException(\sprintf('Private mode is on: the field "%s" can\'t be sent. Only %s are allowed.', $field, implode(', ', $allowed)), $field);
    }
}
