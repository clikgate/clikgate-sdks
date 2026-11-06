<?php

declare(strict_types=1);

namespace Clikgate\Exception;

/** A webhook signature did not verify (`missing_signature`, `malformed_signature`, `timestamp_outside_tolerance`, `no_matching_signature`, `invalid_payload`). */
class SignatureVerificationException extends ClikgateException {}
