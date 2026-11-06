<?php

declare(strict_types=1);

// Laravel example (routes/web.php): capture → save → send goal → verify webhook.
// composer require clikgate/clikgate-laravel; set CLIKGATE_API_KEY (and CLIKGATE_QUEUE=redis to send from a queue).
// The webhook route must skip CSRF: bootstrap/app.php → $middleware->validateCsrfTokens(except: ['webhooks/clikgate']).

use App\Models\Application;
use Clikgate\Exception\SignatureVerificationException;
use Clikgate\Laravel\Facades\Clikgate;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

// 1. Capture: the "clikgate" middleware keeps ?cgid=… in the first-party cookie
Route::middleware('clikgate')->group(function (): void {
    // 2. Save the click ID with your own record
    Route::post('/applications', function (Request $request) {
        $context = Clikgate::clickIds()->context($request); // clickId, keptBy, browserEngine, platform (no User-Agent is sent)
        $application = Application::create(['email' => $request->input('email'), 'click_id' => $context['clickId'], 'kept_by' => $context['keptBy']]);

        return response()->json(['id' => $application->reference], 201);
    });
});

// 1b. Keep the click ID longer in Safari: the web script (data-server-endpoint="/cg/keep") posts it here and the
// server sets the cookie. Same host as the website; CSRF is skipped for this route only (it checks the origin itself).
Route::clikgateKeep('/cg/keep');

// 3. Later, from any controller or job: send the goal (queued with CLIKGATE_QUEUE; never throws)
Route::post('/applications/{application}/approve', function (Application $application) {
    Clikgate::goal('account_opened', [
        'clickId' => $application->click_id,
        'keptBy' => $application->kept_by,       // how the click ID was kept (allowed in private mode)
        'reference' => $application->reference, // your unique ID: a resend never counts twice
        'value' => '2000000',                    // ₦2,000,000 in normal units, as a decimal string
        'currency' => 'NGN',
    ]);

    return ['approved' => true];
});

// 4. Verify Clikgate webhooks over the raw body
Route::post('/webhooks/clikgate', function (Request $request) {
    try {
        $event = Clikgate::verifyWebhook($request->getContent(), $request->header('Clikgate-Signature'), (string) config('services.clikgate.webhook_secret'));
    } catch (SignatureVerificationException $e) {
        return response($e->getErrorCode(), 400);
    }
    if ('goal.completed' === ($event['type'] ?? null)) {
        logger()->info('goal completed', ['event' => $event['id'] ?? null]); // dedupe on the event id
    }

    return response()->noContent(200);
});
