<?php

declare(strict_types=1);

namespace Clikgate\Exception;

/** 401: the API key is missing, invalid, expired or revoked. */
class AuthenticationException extends ClikgateException {}
