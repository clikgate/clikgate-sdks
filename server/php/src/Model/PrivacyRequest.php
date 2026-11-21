<?php

declare(strict_types=1);

namespace Clikgate\Model;

/** A privacy request (access, export, delete or erasure). */
final class PrivacyRequest extends Model
{
    public readonly string $id;
    public readonly ?string $appId;
    public readonly string $type;
    public readonly string $subjectType;
    /** `pending`, `running`, `completed` or `failed`. */
    public readonly string $status;
    /** @var array<string, mixed>|null set once completed: an export's `download_url`, `expires_at`, …, or an erasure's counts */
    public readonly ?array $result;
    public readonly ?string $error;
    public readonly string $createdAt;
    public readonly ?string $completedAt;
    public readonly bool $livemode;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->id = self::string($data, 'id');
        $this->appId = self::str($data, 'app_id');
        $this->type = self::string($data, 'type');
        $this->subjectType = self::string($data, 'subject_type');
        $this->status = self::string($data, 'status');
        $this->result = self::map($data, 'result');
        $this->error = self::str($data, 'error');
        $this->createdAt = self::string($data, 'created_at');
        $this->completedAt = self::str($data, 'completed_at');
        $this->livemode = self::bool($data, 'livemode') ?? false;
    }
}
