<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Http\ApiRequest;
use Clikgate\Http\Requester;

/** Links: create, read, update (with approvals and locks), list and QR codes. */
final class Links
{
    /** @internal */
    public function __construct(private readonly Core $core) {}

    /**
     * Create a link. Its `warnings` include `no_preview` when there is no preview title and image.
     *
     * ```php
     * $link = $clikgate->links->create(['destination_url' => 'https://example.com/spring', 'og_title' => 'Spring sale']);
     * echo $link['short_url'];
     * ```
     *
     * @param array<string, mixed> $params
     * @param array<string, mixed> $requestOptions
     *
     * @return array<string, mixed> the link
     */
    public function create(array $params, array $requestOptions = []): array
    {
        [, $data] = $this->core->requester->request((new ApiRequest('POST', '/v1/links'))->withBody($params)->withOptions($requestOptions));

        return self::arr($data);
    }

    /**
     * Fetch a link by ID.
     *
     * ```php
     * $link = $clikgate->links->get('lnk_01J…');
     * ```
     *
     * @param array<string, mixed> $requestOptions
     *
     * @return array<string, mixed>
     */
    public function get(string $id, array $requestOptions = []): array
    {
        [, $data] = $this->core->requester->request((new ApiRequest('GET', self::path($id)))->withOptions($requestOptions));

        return self::arr($data);
    }

    /**
     * Update a link. A `null` clears a field. With two-person approval on, a destination change answers
     * `202`: the result is `['applied' => false, 'change_request' => […]]`. A locked link throws LinkLockedException.
     *
     * ```php
     * $result = $clikgate->links->update('lnk_01J…', ['destination_url' => 'https://example.com/summer']);
     * if (!$result['applied']) { echo 'waiting for approval: ', $result['change_request']['id']; }
     * ```
     *
     * @param array<string, mixed> $params
     * @param array<string, mixed> $requestOptions
     *
     * @return array{applied: bool, link: array<string, mixed>|null, change_request: array<string, mixed>|null, warnings: list<mixed>}
     */
    public function update(string $id, array $params, array $requestOptions = []): array
    {
        [$status, $data] = $this->core->requester->request((new ApiRequest('PATCH', self::path($id)))->withBody($params)->withOptions($requestOptions));
        $body = self::arr($data);
        if (202 === $status) {
            return ['applied' => false, 'link' => null, 'change_request' => $body, 'warnings' => []];
        }
        $warnings = $body['warnings'] ?? [];

        return ['applied' => true, 'link' => $body, 'change_request' => null, 'warnings' => \is_array($warnings) ? array_values($warnings) : []];
    }

    /**
     * Fetch one page of links (`limit` 1-100, `starting_after`, `ending_before`, `status`, `tag`, …).
     *
     * ```php
     * $page = $clikgate->links->listPage(['limit' => 100, 'tag' => 'promo']);
     * ```
     *
     * @param array<string, mixed> $params
     * @param array<string, mixed> $requestOptions
     *
     * @return array<string, mixed> `{object, data, has_more, next_cursor}`
     */
    public function listPage(array $params = [], array $requestOptions = []): array
    {
        [, $data] = $this->core->requester->request((new ApiRequest('GET', '/v1/links', $params))->withOptions($requestOptions));

        return self::arr($data);
    }

    /**
     * Iterate over every link, fetching pages lazily.
     *
     * ```php
     * foreach ($clikgate->links->list(['status' => 'active', 'limit' => 100]) as $link) { echo $link['short_url'], "\n"; }
     * ```
     *
     * @param array<string, mixed> $params
     * @param array<string, mixed> $requestOptions
     *
     * @return \Generator<int, array<string, mixed>>
     */
    public function list(array $params = [], array $requestOptions = []): \Generator
    {
        $cursor = null;
        while (true) {
            $page = $this->listPage(null === $cursor ? $params : [...$params, 'starting_after' => $cursor], $requestOptions);
            foreach (\is_array($page['data'] ?? null) ? $page['data'] : [] as $item) {
                yield self::arr($item);
            }
            $next = $page['next_cursor'] ?? null;
            if (true !== ($page['has_more'] ?? false) || !\is_string($next) || '' === $next) {
                return;
            }
            $cursor = $next;
        }
    }

    /**
     * Download the link's QR code (`format` svg|png, `size` 256-2048, `margin`, `dark`, `light`).
     *
     * ```php
     * $qr = $clikgate->links->qr('lnk_01J…', ['format' => 'png', 'size' => 1024]);
     * file_put_contents('qr.png', $qr->data);
     * ```
     *
     * @param array{format?: string, size?: int, margin?: int, dark?: string, light?: string} $options
     * @param array<string, mixed>                                                               $requestOptions
     */
    public function qr(string $id, array $options = [], array $requestOptions = []): QrCode
    {
        $res = $this->core->requester->send((new ApiRequest('GET', self::path($id) . '/qr', $options))->withOptions($requestOptions));

        return new QrCode($res->headers['content-type'] ?? 'application/octet-stream', $res->body);
    }

    private static function path(string $id): string
    {
        return '/v1/links/' . Requester::encodePathSegment(Requester::requireId($id));
    }

    /**
     * @internal
     *
     * @return array<string, mixed>
     */
    public static function arr(mixed $data): array
    {
        /** @var array<string, mixed> */
        return \is_array($data) ? $data : [];
    }
}
