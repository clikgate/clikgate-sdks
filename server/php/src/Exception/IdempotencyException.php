<?php

declare(strict_types=1);

namespace Clikgate\Exception;

/** 409 `idempotency_*`: the key was used with a different request, or the first request is still running. */
class IdempotencyException extends ClikgateException {}
