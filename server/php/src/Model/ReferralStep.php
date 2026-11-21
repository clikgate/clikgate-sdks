<?php

declare(strict_types=1);

namespace Clikgate\Model;

/** A qualification step the referee completed. */
final class ReferralStep extends Model
{
    /** The step's position in the program's steps (0 is the first). */
    public readonly int $index;
    /** The step's goal key; null for identify steps. */
    public readonly ?string $goal;
    /** True for an identify step. */
    public readonly bool $identify;
    public readonly string $completedAt;
    public readonly ?string $sourceId;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->index = self::int($data, 'index') ?? 0;
        $this->goal = self::str($data, 'goal');
        $this->identify = self::bool($data, 'identify') ?? false;
        $this->completedAt = self::string($data, 'completed_at');
        $this->sourceId = self::str($data, 'source_id');
    }
}
