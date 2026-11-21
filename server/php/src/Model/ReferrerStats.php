<?php

declare(strict_types=1);

namespace Clikgate\Model;

/** A referrer's counters, refreshed regularly (not live). */
final class ReferrerStats extends Model
{
    /** Human clicks on the referrer's link. */
    public readonly int $clicks;
    /** Referrals of any status. */
    public readonly int $installs;
    /** Referrals past their first qualification step (rejected ones excluded). */
    public readonly int $signups;
    /** Open referrals. */
    public readonly int $inProgress;
    public readonly int $qualified;
    public readonly int $disqualified;
    public readonly int $rejected;
    /** Share of referees (0 to 1) who uninstalled within 7 days; null when none is old enough yet. */
    public readonly ?float $refereeUninstallRate7d;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->clicks = self::int($data, 'clicks') ?? 0;
        $this->installs = self::int($data, 'installs') ?? 0;
        $this->signups = self::int($data, 'signups') ?? 0;
        $this->inProgress = self::int($data, 'in_progress') ?? 0;
        $this->qualified = self::int($data, 'qualified') ?? 0;
        $this->disqualified = self::int($data, 'disqualified') ?? 0;
        $this->rejected = self::int($data, 'rejected') ?? 0;
        $this->refereeUninstallRate7d = self::float($data, 'referee_uninstall_rate_7d');
    }
}
