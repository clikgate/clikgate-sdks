<?php

declare(strict_types=1);

// Clikgate (php artisan vendor:publish --tag=clikgate-config). Every key can stay as is: the API key comes
// from CLIKGATE_API_KEY. See https://clikgate.com/docs/sdks/php/laravel.

return [
    // cg_live_… or cg_test_… (Developers → API keys)
    'api_key' => env('CLIKGATE_API_KEY'),
    'base_url' => env('CLIKGATE_BASE_URL'),

    // sync (default), after_response (sent after the response has gone to the visitor) or background
    'send_mode' => env('CLIKGATE_SEND_MODE', 'sync'),

    // A queue connection (e.g. "redis") makes Clikgate::goal() dispatch a queued job instead (recommended).
    'queue' => env('CLIKGATE_QUEUE'),
    'queue_name' => env('CLIKGATE_QUEUE_NAME'),

    // "auto" (follow the organisation's setting), true or false
    'private_mode' => env('CLIKGATE_PRIVATE_MODE', 'auto'),

    // seconds, per attempt
    'timeout' => is_numeric(env('CLIKGATE_TIMEOUT')) ? (float) env('CLIKGATE_TIMEOUT') : 3.0,
    'max_retries' => is_numeric(env('CLIKGATE_MAX_RETRIES')) ? (int) env('CLIKGATE_MAX_RETRIES') : 3,
    'proxy' => env('CLIKGATE_PROXY'),
    'click_id_param' => env('CLIKGATE_CLICK_ID_PARAM'),

    // The click-ID cookie written by the "clikgate" middleware and by Route::clikgateKeep('/cg/keep') (days: 1-400)
    'cookie' => [
        'persist' => true,
        'days' => 30,
        'domain' => env('CLIKGATE_COOKIE_DOMAIN'),
        // /cg/keep always adds Secure unless this is false (e.g. plain http://localhost while developing)
        'keep_secure' => true,
    ],
];
