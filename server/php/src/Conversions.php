<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Http\ApiRequest;
use Clikgate\Http\Requester;

/** Conversions: the older API. New integrations should use goals. */
final class Conversions
{
    /** @internal */
    public function __construct(private readonly Core $core) {}

    /**
     * Report a conversion (`POST /v1/conversions`). `$params` use the API's field names.
     * In private mode only `external_id`, `goal`, `click_id`, `code`, `reference`, `value`, `currency`, `provider`,
     * `is_first`, `occurred_at`, `consent`, `kept_by`, `browser_engine`, `platform` and the hashed identifiers
     * `hashed_email`, `hashed_phone_e164`, `hashed_phone_digits` (64 lowercase hex; `HashForAds::hash()`) are allowed;
     * a malformed hash is a local `invalid_hashed_identifier`.
     *
     * ```php
     * $clikgate->conversions->create(['external_id' => 'ORD-1001', 'click_id' => $clickId, 'goal' => 'order_paid', 'value' => '1500.50', 'currency' => 'NGN']);
     * ```
     *
     * @param array<string, mixed> $params
     * @param array<string, mixed> $requestOptions
     *
     * With `goal` set to a Payment goal this is a trusted payment confirmation: send `provider` and the payment
     * reference (`external_id`); the answer is then the goal event (`'object' => 'goal_event'`) instead of a conversion.
     *
     * @return array<string, mixed>
     */
    public function create(array $params, array $requestOptions = []): array
    {
        $body = self::withValue($params);
        HashForAds::checkFields($body);
        if ($this->core->guardState()[0]) {
            Guard::check('conversion', $body);
        }
        [, $data] = $this->core->requester->request((new ApiRequest('POST', '/v1/conversions'))->withBody($body)->withOptions($requestOptions));

        return Links::arr($data);
    }

    /**
     * Reverse a conversion, fully or partly (`amount_minor`).
     *
     * ```php
     * $clikgate->conversions->reverse('cnv_01J…', ['amount_minor' => 200000]);
     * ```
     *
     * @param array<string, mixed> $params
     * @param array<string, mixed> $requestOptions
     *
     * @return array<string, mixed>
     */
    public function reverse(string $id, array $params = [], array $requestOptions = []): array
    {
        $body = self::withValue($params);
        if ($this->core->guardState()[0]) {
            Guard::check('reversal', $body);
        }
        $path = '/v1/conversions/' . Requester::encodePathSegment(Requester::requireId($id)) . '/reverse';
        [, $data] = $this->core->requester->request((new ApiRequest('POST', $path))->withBody($body)->withOptions($requestOptions));

        return Links::arr($data);
    }

    /**
     * @param array<string, mixed> $params
     *
     * @return array<string, mixed>
     */
    private static function withValue(array $params): array
    {
        if (isset($params['value'])) {
            $params['value'] = Money::formatValue($params['value']);
        }

        return $params;
    }
}
