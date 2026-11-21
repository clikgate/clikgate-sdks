<?php

declare(strict_types=1);

namespace Clikgate\Model;

/** Reward information, for your records: Clikgate never pays rewards. */
final class RewardInfo extends Model
{
    /** What the referrer gets. */
    public readonly ?RewardSide $referrer;
    /** What the referee gets. */
    public readonly ?RewardSide $referee;
    public readonly ?string $note;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $referrer = self::map($data, 'referrer');
        $referee = self::map($data, 'referee');
        $this->referrer = null === $referrer ? null : new RewardSide($referrer);
        $this->referee = null === $referee ? null : new RewardSide($referee);
        $this->note = self::str($data, 'note');
    }

    protected function derived(): array
    {
        $out = [];
        if (null !== $this->referrer) {
            $out['referrer'] = $this->referrer->toArray();
        }
        if (null !== $this->referee) {
            $out['referee'] = $this->referee->toArray();
        }

        return $out;
    }
}
