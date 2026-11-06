<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Http\ApiRequest;
use Clikgate\Http\Requester;

/** Clicks. */
final class Clicks
{
    /** @internal */
    public function __construct(private readonly Core $core) {}

    /**
     * Fetch a click by its ID (`clk_…`).
     *
     * ```php
     * $click = $clikgate->clicks->get($clickId);
     * echo $click['country'];
     * ```
     *
     * @param array<string, mixed> $requestOptions
     *
     * @return array<string, mixed>
     */
    public function get(string $clickId, array $requestOptions = []): array
    {
        $path = '/v1/clicks/' . Requester::encodePathSegment(Requester::requireId($clickId, 'click_id'));
        [, $data] = $this->core->requester->request((new ApiRequest('GET', $path))->withOptions($requestOptions));

        return Links::arr($data);
    }
}
