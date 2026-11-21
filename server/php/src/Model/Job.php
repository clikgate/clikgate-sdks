<?php

declare(strict_types=1);

namespace Clikgate\Model;

/** A background job, e.g. a referrer import. */
final class Job extends Model
{
    public readonly string $id;
    public readonly string $type;
    /** `queued`, `running`, `succeeded`, `partially_failed`, `failed`. */
    public readonly string $status;
    public readonly int $total;
    public readonly int $succeeded;
    public readonly int $failed;
    /** @var list<array<string, mixed>> one item per input row (`index`, `ok`, `referrer_id`, `created`, `error`) */
    public readonly array $results;
    public readonly string $createdAt;
    public readonly ?string $finishedAt;
    public readonly bool $livemode;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->id = self::string($data, 'id');
        $this->type = self::string($data, 'type');
        $this->status = self::string($data, 'status');
        $this->total = self::int($data, 'total') ?? 0;
        $this->succeeded = self::int($data, 'succeeded') ?? 0;
        $this->failed = self::int($data, 'failed') ?? 0;
        $this->results = self::maps($data, 'results');
        $this->createdAt = self::string($data, 'created_at');
        $this->finishedAt = self::str($data, 'finished_at');
        $this->livemode = self::bool($data, 'livemode') ?? false;
    }
}
