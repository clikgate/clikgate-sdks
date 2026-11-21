<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Http\ApiRequest;
use Clikgate\Http\Requester;
use Clikgate\Model\Link;
use Clikgate\Model\LinkChangeRequest;
use Clikgate\Model\LinkUpdateResult;
use Clikgate\Model\Page;

/**
 * Links: create, read, update (with approvals and locks), list, archive, pause and resume, and QR codes.
 *
 * The methods return typed models ({@see Link}, {@see LinkUpdateResult}, {@see Page}). They keep array access over the
 * wire keys, so `$link['short_url']` and `$result['change_request']['id']` still work.
 *
 * @phpstan-type LinkCreateParams array{destination_url?: string, slug?: ?string, domain?: ?string, fallback_url?: ?string, title?: ?string, og_title?: ?string, og_description?: ?string, og_image_url?: ?string, tags?: list<string>, metadata?: array<string, mixed>, attribution_window_days?: ?int, utm_template?: ?string, expires_at?: \DateTimeInterface|string|null, external_reference?: ?string, campaign_id?: ?string, end_goal_key?: ?string, kind?: ?string, app_ids?: list<string>, deep_link_path?: ?string, deep_link_data?: array<string, mixed>, app_behavior?: ?string, ios_interstitial?: ?string}
 * @phpstan-type LinkUpdateParams array{destination_url?: ?string, fallback_url?: ?string, title?: ?string, og_title?: ?string, og_description?: ?string, og_image_url?: ?string, tags?: ?list<string>, metadata?: ?array<string, mixed>, attribution_window_days?: ?int, utm_template?: ?string, expires_at?: \DateTimeInterface|string|null, campaign_id?: ?string, end_goal_key?: ?string, app_ids?: ?list<string>, deep_link_path?: ?string, deep_link_data?: ?array<string, mixed>, app_behavior?: ?string, ios_interstitial?: ?string}
 */
final class Links
{
    /** @internal */
    public function __construct(private readonly Core $core) {}

    /**
     * Create a link. Its `warnings` include `no_preview` when there is no preview title and image.
     *
     * ```php
     * $link = $clikgate->links->create(['destination_url' => 'https://example.com/spring', 'og_title' => 'Spring sale']);
     * echo $link->shortUrl;   // or $link['short_url']
     * ```
     *
     * @param LinkCreateParams|array<string, mixed> $params the API's field names
     * @param array<string, mixed>                  $requestOptions
     */
    public function create(array $params, array $requestOptions = []): Link
    {
        [, $data] = $this->core->requester->request((new ApiRequest('POST', '/v1/links'))->withBody($params)->withOptions($requestOptions));

        return new Link(self::arr($data));
    }

    /**
     * Fetch a link by ID.
     *
     * ```php
     * $link = $clikgate->links->get('lnk_01J…');
     * ```
     *
     * @param array<string, mixed> $requestOptions
     */
    public function get(string $id, array $requestOptions = []): Link
    {
        [, $data] = $this->core->requester->request((new ApiRequest('GET', self::path($id)))->withOptions($requestOptions));

        return new Link(self::arr($data));
    }

    /**
     * Update a link. A `null` clears a field. With two-person approval on, a destination change answers
     * `202`: the result is `['applied' => false, 'change_request' => […]]`. A locked link throws LinkLockedException.
     *
     * ```php
     * $result = $clikgate->links->update('lnk_01J…', ['destination_url' => 'https://example.com/summer']);
     * if (!$result->applied) { echo 'waiting for approval: ', $result->changeRequest?->id; }
     * ```
     *
     * @param LinkUpdateParams|array<string, mixed> $params
     * @param array<string, mixed>                  $requestOptions
     */
    public function update(string $id, array $params, array $requestOptions = []): LinkUpdateResult
    {
        [$status, $data] = $this->core->requester->request((new ApiRequest('PATCH', self::path($id)))->withBody($params)->withOptions($requestOptions));
        $body = self::arr($data);
        if (202 === $status) {
            return new LinkUpdateResult(false, null, new LinkChangeRequest($body));
        }

        return new LinkUpdateResult(true, new Link($body), null);
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
     * @return Page<Link> `data`, `hasMore`, `nextCursor`
     */
    public function listPage(array $params = [], array $requestOptions = []): Page
    {
        [, $data] = $this->core->requester->request((new ApiRequest('GET', '/v1/links', $params))->withOptions($requestOptions));

        return new Page(self::arr($data), static fn(array $l): Link => new Link($l));
    }

    /**
     * Iterate over every link, fetching pages lazily.
     *
     * ```php
     * foreach ($clikgate->links->list(['status' => 'active', 'limit' => 100]) as $link) { echo $link->shortUrl, "\n"; }
     * ```
     *
     * @param array<string, mixed> $params
     * @param array<string, mixed> $requestOptions
     *
     * @return \Generator<int, Link>
     */
    public function list(array $params = [], array $requestOptions = []): \Generator
    {
        $cursor = null;
        while (true) {
            $page = $this->listPage(null === $cursor ? $params : [...$params, 'starting_after' => $cursor], $requestOptions);
            yield from $page->data;
            if (!$page->hasMore || null === $page->nextCursor || '' === $page->nextCursor) {
                return;
            }
            $cursor = $page->nextCursor;
        }
    }

    /**
     * Archive a link (`DELETE /v1/links/{id}`): it stops redirecting. Returns the archived link.
     *
     * ```php
     * $link = $clikgate->links->archive('lnk_01J…');
     * ```
     *
     * @param array<string, mixed> $requestOptions
     */
    public function archive(string $id, array $requestOptions = []): Link
    {
        [, $data] = $this->core->requester->request((new ApiRequest('DELETE', self::path($id)))->withOptions($requestOptions));

        return new Link(self::arr($data));
    }

    /**
     * Fetch a link by your own external reference (`external_reference`).
     *
     * ```php
     * $link = $clikgate->links->getByReference('order-1001');
     * ```
     *
     * @param array<string, mixed> $requestOptions
     */
    public function getByReference(string $reference, array $requestOptions = []): Link
    {
        $path = '/v1/links/by-reference/' . Requester::encodePathSegment(Requester::requireId($reference, 'reference'));
        [, $data] = $this->core->requester->request((new ApiRequest('GET', $path))->withOptions($requestOptions));

        return new Link(self::arr($data));
    }

    /**
     * Pause a link: visitors see the paused page until you resume it.
     *
     * ```php
     * $link = $clikgate->links->pause('lnk_01J…');
     * ```
     *
     * @param array<string, mixed> $requestOptions
     */
    public function pause(string $id, array $requestOptions = []): Link
    {
        [, $data] = $this->core->requester->request((new ApiRequest('POST', self::path($id) . '/pause'))->withOptions($requestOptions));

        return new Link(self::arr($data));
    }

    /**
     * Resume a paused link.
     *
     * ```php
     * $link = $clikgate->links->resume('lnk_01J…');
     * ```
     *
     * @param array<string, mixed> $requestOptions
     */
    public function resume(string $id, array $requestOptions = []): Link
    {
        [, $data] = $this->core->requester->request((new ApiRequest('POST', self::path($id) . '/resume'))->withOptions($requestOptions));

        return new Link(self::arr($data));
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
