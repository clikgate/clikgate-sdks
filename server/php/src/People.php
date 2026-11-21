<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Http\ApiRequest;
use Clikgate\Model\Page;
use Clikgate\Model\Person;
use Clikgate\Model\PersonSummary;

/** People: one customer across clicks, installs and your customer ID (SPEC section 32). */
final class People
{
    /** @internal */
    public function __construct(private readonly Core $core) {}

    /**
     * Fetch a person.
     *
     * ```php
     * $person = $clikgate->people->get('per_01J…');
     * ```
     *
     * @param array<string, mixed> $requestOptions
     */
    public function get(string $personId, array $requestOptions = []): Person
    {
        [, $data] = $this->core->requester->request((new ApiRequest('GET', '/v1/people/' . Referrals::id($personId, 'person_id')))->withOptions($requestOptions));

        return new Person(Links::arr($data));
    }

    /**
     * Fetch one page of people matching a label, customer ID or click ID. The text goes in the body, never the URL.
     *
     * ```php
     * $page = $clikgate->people->searchPage('Ada', ['limit' => 20]);
     * ```
     *
     * @param array{cursor?: ?string, limit?: ?int} $options
     * @param array<string, mixed>                  $requestOptions
     *
     * @return Page<PersonSummary>
     */
    public function searchPage(string $q, array $options = [], array $requestOptions = []): Page
    {
        $body = Referrals::defined(['q' => $q, 'cursor' => $options['cursor'] ?? null, 'limit' => $options['limit'] ?? null]);
        [, $data] = $this->core->requester->request((new ApiRequest('POST', '/v1/people/search'))->withBody($body)->withOptions($requestOptions));

        return new Page(Links::arr($data), static fn(array $p): PersonSummary => new PersonSummary($p));
    }

    /**
     * Iterate over every person matching the text, fetching pages lazily.
     *
     * ```php
     * foreach ($clikgate->people->search('Ada') as $person) { echo $person->id, ' ', $person->label, "\n"; }
     * ```
     *
     * @param array{limit?: ?int}  $options
     * @param array<string, mixed> $requestOptions
     *
     * @return \Generator<int, PersonSummary>
     */
    public function search(string $q, array $options = [], array $requestOptions = []): \Generator
    {
        $cursor = null;
        while (true) {
            $page = $this->searchPage($q, ['cursor' => $cursor, 'limit' => $options['limit'] ?? null], $requestOptions);
            yield from $page->data;
            if (!$page->hasMore || null === $page->nextCursor || '' === $page->nextCursor) {
                return;
            }
            $cursor = $page->nextCursor;
        }
    }

    /**
     * Set a person's label (`null` clears it).
     *
     * ```php
     * $clikgate->people->setLabel('per_01J…', 'Ada (VIP)');
     * ```
     *
     * @param array<string, mixed> $requestOptions
     */
    public function setLabel(string $personId, ?string $label, array $requestOptions = []): Person
    {
        $req = (new ApiRequest('PATCH', '/v1/people/' . Referrals::id($personId, 'person_id')))->withBody(['label' => $label])->withOptions($requestOptions);
        [, $data] = $this->core->requester->request($req);

        return new Person(Links::arr($data));
    }
}
