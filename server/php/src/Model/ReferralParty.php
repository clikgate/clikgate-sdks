<?php

declare(strict_types=1);

namespace Clikgate\Model;

/**
 * A referral's program (`id`, `name`), referrer (`id`, `customerId`, `code`) or referee (`installId`,
 * `installationId`, `customerId`). Fields that don't apply are null.
 */
final class ReferralParty extends Model
{
    public readonly ?string $id;
    /** The program's name. */
    public readonly ?string $name;
    /** The customer ID (wire `customer_user_id`). */
    public readonly ?string $customerId;
    /** The referrer's code. */
    public readonly ?string $code;
    /** The referee's install (`ins_…`). */
    public readonly ?string $installId;
    /** The referee's installation ID. */
    public readonly ?string $installationId;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->id = self::str($data, 'id');
        $this->name = self::str($data, 'name');
        $this->customerId = self::str($data, 'customer_user_id');
        $this->code = self::str($data, 'code');
        $this->installId = self::str($data, 'install_id');
        $this->installationId = self::str($data, 'installation_id');
    }
}
