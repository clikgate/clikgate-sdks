<?php

declare(strict_types=1);

namespace Clikgate\Model;

use Clikgate\Currency;

/** One side's reward. */
final class RewardSide extends Model
{
    /** The amount in the currency's minor units, as the API sends it. */
    public readonly ?int $amountMinor;
    /** ISO 4217 code. */
    public readonly ?string $currency;
    /** The same amount in normal units, with the currency's exponent (`'500.00'`). Added by the SDK. */
    public readonly ?string $amount;
    /** The reward in words. */
    public readonly ?string $description;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->amountMinor = self::int($data, 'amount_minor');
        $this->currency = self::str($data, 'currency');
        $this->description = self::str($data, 'description');
        $this->amount = null !== $this->amountMinor && null !== $this->currency && '' !== $this->currency ? Currency::minorToAmount($this->amountMinor, $this->currency) : null;
    }

    protected function derived(): array
    {
        return null === $this->amount ? [] : ['amount' => $this->amount];
    }
}
