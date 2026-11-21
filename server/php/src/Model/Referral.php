<?php

declare(strict_types=1);

namespace Clikgate\Model;

/** A referral: an install matched to a referrer, and its progress through the program's steps. */
final class Referral extends Model
{
    /** `ref_…` */
    public readonly string $id;
    public readonly string $programId;
    public readonly string $referrerId;
    /** `installed`, `in_progress`, `holding`, `qualified`, `disqualified`, `rejected`, … */
    public readonly string $status;
    public readonly string $source;
    public readonly ?string $matchType;
    public readonly int $currentStep;
    /** @var list<ReferralStep> */
    public readonly array $stepsCompleted;
    public readonly ?string $stepDeadlineAt;
    public readonly ?string $holdUntil;
    public readonly ?string $qualifiedAt;
    public readonly ?string $disqualifiedAt;
    public readonly ?string $rejectedAt;
    public readonly ?string $reason;
    public readonly ?string $reasonDetail;
    public readonly ?string $reasonMessage;
    /** @var list<string> */
    public readonly array $fraudFlags;
    public readonly bool $refereeUninstalledAfterQualification;
    /** `id`, `name`. */
    public readonly ReferralParty $program;
    /** `id`, `customerId`, `code`. */
    public readonly ReferralParty $referrer;
    /** `installId`, `installationId`, `customerId`. */
    public readonly ReferralParty $referee;
    /** The link the referee came through (wire `link.id`), or null. */
    public readonly ?string $linkId;
    public readonly ?string $clickId;
    /** The program's reward when the referral qualified (wire `reward_snapshot`); null when there was none. */
    public readonly ?RewardInfo $reward;
    public readonly string $createdAt;
    public readonly string $updatedAt;
    public readonly bool $livemode;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->id = self::string($data, 'id');
        $this->programId = self::string($data, 'program_id');
        $this->referrerId = self::string($data, 'referrer_id');
        $this->status = self::string($data, 'status');
        $this->source = self::string($data, 'source');
        $this->matchType = self::str($data, 'match_type');
        $this->currentStep = self::int($data, 'current_step') ?? 0;
        $this->stepsCompleted = array_map(static fn(array $s): ReferralStep => new ReferralStep($s), self::maps($data, 'steps_completed'));
        $this->stepDeadlineAt = self::str($data, 'step_deadline_at');
        $this->holdUntil = self::str($data, 'hold_until');
        $this->qualifiedAt = self::str($data, 'qualified_at');
        $this->disqualifiedAt = self::str($data, 'disqualified_at');
        $this->rejectedAt = self::str($data, 'rejected_at');
        $this->reason = self::str($data, 'reason');
        $this->reasonDetail = self::str($data, 'reason_detail');
        $this->reasonMessage = self::str($data, 'reason_message');
        $this->fraudFlags = self::strings($data, 'fraud_flags');
        $this->refereeUninstalledAfterQualification = self::bool($data, 'referee_uninstalled_after_qualification') ?? false;
        $this->program = new ReferralParty(self::map($data, 'program') ?? []);
        $this->referrer = new ReferralParty(self::map($data, 'referrer') ?? []);
        $this->referee = new ReferralParty(self::map($data, 'referee') ?? []);
        $link = self::map($data, 'link');
        $this->linkId = null === $link ? null : self::str($link, 'id');
        $this->clickId = self::str($data, 'click_id');
        $reward = self::map($data, 'reward_snapshot');
        $this->reward = null === $reward ? null : new RewardInfo($reward);
        $this->createdAt = self::string($data, 'created_at');
        $this->updatedAt = self::string($data, 'updated_at');
        $this->livemode = self::bool($data, 'livemode') ?? false;
    }

    protected function derived(): array
    {
        return null === $this->reward ? [] : ['reward_snapshot' => $this->reward->toArray()];
    }
}
