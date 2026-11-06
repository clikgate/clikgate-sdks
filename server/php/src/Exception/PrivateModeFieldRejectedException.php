<?php

declare(strict_types=1);

namespace Clikgate\Exception;

/** Private mode refused a field (locally, before sending, or by the API). Carries the field **name** only. */
class PrivateModeFieldRejectedException extends InvalidRequestException
{
    /**
     * @param array<string, mixed>|null $raw
     */
    public function __construct(string $message, private readonly string $field, ?int $httpStatus = null, ?string $requestId = null, ?string $errorType = null, ?array $raw = null)
    {
        parent::__construct($message, 'private_mode_field_rejected', $httpStatus, $requestId, $field, $errorType, $raw);
    }

    /** The refused field name, e.g. `metadata`. Never its value. */
    public function getField(): string
    {
        return $this->field;
    }
}
