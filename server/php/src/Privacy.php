<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Http\ApiRequest;
use Clikgate\Model\PrivacyRequest;

/** Privacy requests: access, export, delete or erase a subject's data (SPEC section 30). */
final class Privacy
{
    /** @internal */
    public function __construct(private readonly Core $core) {}

    /**
     * Ask for a subject's data to be exported, or erased. The request completes in the background.
     *
     * ```php
     * $request = $clikgate->privacy->createRequest(['type' => 'erasure', 'subjectType' => 'customer_user', 'subjectId' => (string) $user->id]);
     * ```
     *
     * @param array{type: string, subjectType: string, subjectId: string, appId?: ?string} $params `type`: access, export, delete or erasure; `subjectType`: installation, customer_user, email, phone, person or click
     * @param array<string, mixed>                                                          $requestOptions
     */
    public function createRequest(array $params, array $requestOptions = []): PrivacyRequest
    {
        $body = Referrals::defined([
            'type' => $params['type'],
            'subject_type' => $params['subjectType'],
            'subject_id' => $params['subjectId'],
            'app_id' => $params['appId'] ?? null,
        ]);
        [, $data] = $this->core->requester->request((new ApiRequest('POST', '/v1/privacy/requests'))->withBody($body)->withOptions($requestOptions));

        return new PrivacyRequest(Links::arr($data));
    }

    /**
     * Fetch a privacy request (an export's `result` has its download link once completed).
     *
     * ```php
     * $request = $clikgate->privacy->getRequest('prq_01J…');
     * ```
     *
     * @param array<string, mixed> $requestOptions
     */
    public function getRequest(string $requestId, array $requestOptions = []): PrivacyRequest
    {
        [, $data] = $this->core->requester->request((new ApiRequest('GET', '/v1/privacy/requests/' . Referrals::id($requestId, 'request_id')))->withOptions($requestOptions));

        return new PrivacyRequest(Links::arr($data));
    }
}
