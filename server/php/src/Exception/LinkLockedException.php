<?php

declare(strict_types=1);

namespace Clikgate\Exception;

/** 409 `link_locked`: destination, fallback and deep-link changes are refused. Never retried. */
class LinkLockedException extends ConflictException {}
