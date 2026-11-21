<?php

declare(strict_types=1);

namespace Clikgate\Model;

/**
 * The result of `links->update()`: applied now (`applied`, `link`), or waiting for a second person's approval
 * (`changeRequest`). `$result['applied']` and `$result['change_request']['id']` keep working.
 */
final class LinkUpdateResult extends Model
{
    public readonly bool $applied;
    public readonly ?Link $link;
    public readonly ?LinkChangeRequest $changeRequest;
    /** @var list<array<string, mixed>> */
    public readonly array $warnings;

    public function __construct(bool $applied, ?Link $link, ?LinkChangeRequest $changeRequest)
    {
        $warnings = null === $link ? [] : $link->warnings;
        parent::__construct(['applied' => $applied, 'link' => $link?->toArray(), 'change_request' => $changeRequest?->toArray(), 'warnings' => $warnings]);
        $this->applied = $applied;
        $this->link = $link;
        $this->changeRequest = $changeRequest;
        $this->warnings = $warnings;
    }
}
