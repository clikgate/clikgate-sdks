<?php

declare(strict_types=1);

namespace Clikgate\Model;

/** The answer of `codes->redeem()`. */
final class CodeRedemption extends Model
{
    public readonly string $offlineTouchId;
    /** @var array<string, mixed> the code: `code`, `kind`, `link_id`, `campaign_id`, `referrer_id`, `program_id` */
    public readonly array $code;
    /** The referral the redemption created or found; null otherwise. */
    public readonly ?Referral $referral;
    /** True once the touch is tied to an install. */
    public readonly bool $linked;
    /** Why a referral code didn't create a referral (e.g. `already_referred`); null otherwise. */
    public readonly ?string $referralErrorCode;
    public readonly ?string $referralErrorMessage;
    public readonly bool $livemode;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->offlineTouchId = self::string($data, 'offline_touch_id');
        $this->code = self::map($data, 'code') ?? [];
        $referral = self::map($data, 'referral');
        $this->referral = null === $referral ? null : new Referral($referral);
        $this->linked = self::bool($data, 'linked') ?? false;
        $error = self::map($data, 'referral_error');
        $this->referralErrorCode = null === $error ? null : self::str($error, 'code');
        $this->referralErrorMessage = null === $error ? null : self::str($error, 'message');
        $this->livemode = self::bool($data, 'livemode') ?? false;
    }

    protected function derived(): array
    {
        return null === $this->referral ? [] : ['referral' => $this->referral->toArray()];
    }
}
