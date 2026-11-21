<?php

declare(strict_types=1);

namespace Clikgate\Model;

/** A pending destination change awaiting a second person's approval (`202` on `links->update()`). */
final class LinkChangeRequest extends Model
{
    /** `lcr_…` */
    public readonly string $id;
    public readonly string $linkId;
    /** `pending`, `approved`, `rejected` or `expired`. */
    public readonly string $status;
    public readonly string $fromUrl;
    public readonly string $toUrl;
    public readonly ?string $requestedBy;
    public readonly ?string $requestedByType;
    public readonly ?string $decidedBy;
    public readonly ?string $decidedAt;
    public readonly ?string $decisionNote;
    public readonly ?string $expiresAt;
    public readonly string $createdAt;
    public readonly bool $livemode;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->id = self::string($data, 'id');
        $this->linkId = self::string($data, 'link_id');
        $this->status = self::string($data, 'status');
        $this->fromUrl = self::string($data, 'from_url');
        $this->toUrl = self::string($data, 'to_url');
        $this->requestedBy = self::str($data, 'requested_by');
        $this->requestedByType = self::str($data, 'requested_by_type');
        $this->decidedBy = self::str($data, 'decided_by');
        $this->decidedAt = self::str($data, 'decided_at');
        $this->decisionNote = self::str($data, 'decision_note');
        $this->expiresAt = self::str($data, 'expires_at');
        $this->createdAt = self::string($data, 'created_at');
        $this->livemode = self::bool($data, 'livemode') ?? false;
    }
}
