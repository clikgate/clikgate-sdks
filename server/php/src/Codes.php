<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Http\ApiRequest;
use Clikgate\Model\CodeRedemption;

/** Offline and referral codes (SPEC section 32). */
final class Codes
{
    /** @internal */
    public function __construct(private readonly Core $core) {}

    /**
     * Redeem a code received offline (USSD, a till, an agent). A referral code can create a referral. `subject` (`['type' => …, 'id' => …]`) and
     * `location` (`country`, `region`, `city`, `store_id`) are sent as given.
     *
     * ```php
     * $redemption = $clikgate->codes->redeem(['externalId' => 'POS-991', 'code' => 'ADA42', 'channel' => 'pos']);
     * if (null !== $redemption->referral) { echo $redemption->referral->id; }
     * ```
     *
     * @param array{externalId: string, code: string, channel: string, appId?: ?string, occurredAt?: \DateTimeInterface|string|null, metadata?: ?array<string, mixed>, subject?: ?array{type: string, id?: ?string}, agentId?: ?string, location?: ?array{country?: ?string, region?: ?string, city?: ?string, store_id?: ?string}} $params
     * @param array<string, mixed>                                                                                                                                       $requestOptions
     */
    public function redeem(array $params, array $requestOptions = []): CodeRedemption
    {
        $occurredAt = $params['occurredAt'] ?? null;
        $body = Referrals::defined([
            'external_id' => $params['externalId'],
            'code' => $params['code'],
            'channel' => $params['channel'],
            'app_id' => $params['appId'] ?? null,
            'occurred_at' => null === $occurredAt ? null : \Clikgate\Http\Requester::formatDate($occurredAt),
            'metadata' => $params['metadata'] ?? null,
            'subject' => $params['subject'] ?? null,
            'agent_id' => $params['agentId'] ?? null,
            'location' => $params['location'] ?? null,
        ]);
        [, $data] = $this->core->requester->request((new ApiRequest('POST', '/v1/codes/redeem'))->withBody($body)->withOptions($requestOptions));

        return new CodeRedemption(Links::arr($data));
    }
}
