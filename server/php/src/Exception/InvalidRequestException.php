<?php

declare(strict_types=1);

namespace Clikgate\Exception;

/** 400, 410, 422 and other 4xx; also local validation (`getHttpStatus()` is null). */
class InvalidRequestException extends ClikgateException
{
    private ?int $index = null;

    /** For batch calls: the index of the event that failed local validation. */
    public function getIndex(): ?int
    {
        return $this->index;
    }

    /** @internal */
    public function withIndex(int $index): static
    {
        $this->index = $index;

        return $this;
    }

    /**
     * On `test_destination_not_allowed`: the allowed destination kinds.
     *
     * @return list<string>|null
     */
    public function getAllowed(): ?array
    {
        $v = $this->rawValue('allowed');
        if (!\is_array($v)) {
            return null;
        }

        return array_values(array_map(static fn(mixed $x): string => \is_scalar($x) ? (string) $x : '', $v));
    }

    /** On `test_destination_not_allowed`: the docs page explaining test-link destinations. */
    public function getDocUrl(): ?string
    {
        $v = $this->rawValue('doc_url');

        return \is_string($v) ? $v : null;
    }
}
