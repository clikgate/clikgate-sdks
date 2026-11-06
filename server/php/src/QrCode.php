<?php

declare(strict_types=1);

namespace Clikgate;

/** QR code bytes and their content type (`image/svg+xml` or `image/png`). Also the generated layer's binary result. */
final class QrCode
{
    public function __construct(public readonly string $contentType, public readonly string $data) {}
}
