<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Http\ApiRequest;
use Clikgate\Model\Install;

/** Installs of your apps (SPEC section 32). The API currently needs `appId`. */
final class Installs
{
    /** @internal */
    public function __construct(private readonly Core $core) {}

    /**
     * The latest install of one of your customers (the customer ID you sent with `identifyUser`).
     *
     * ```php
     * $install = $clikgate->installs->getByCustomer((string) $user->id, ['appId' => 'app_01J…']);
     * ```
     *
     * @param array{appId?: ?string} $options
     * @param array<string, mixed>   $requestOptions
     */
    public function getByCustomer(string $customerId, array $options = [], array $requestOptions = []): Install
    {
        return $this->fetch('/v1/installs/by-customer-user/' . Referrals::id($customerId, 'customer_id'), $options, $requestOptions);
    }

    /**
     * An install by its installation ID (from the `Clikgate-Installation` header).
     *
     * ```php
     * $install = $clikgate->installs->getByInstallation($installation->installationId, ['appId' => $installation->appId]);
     * ```
     *
     * @param array{appId?: ?string} $options
     * @param array<string, mixed>   $requestOptions
     */
    public function getByInstallation(string $installationId, array $options = [], array $requestOptions = []): Install
    {
        return $this->fetch('/v1/installs/by-installation/' . Referrals::id($installationId, 'installation_id'), $options, $requestOptions);
    }

    /**
     * @param array{appId?: ?string} $options
     * @param array<string, mixed>   $requestOptions
     */
    private function fetch(string $path, array $options, array $requestOptions): Install
    {
        $query = Referrals::defined(['app_id' => $options['appId'] ?? null]);
        [, $data] = $this->core->requester->request((new ApiRequest('GET', $path, $query))->withOptions($requestOptions));

        return new Install(Links::arr($data));
    }
}
