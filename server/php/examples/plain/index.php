<?php

declare(strict_types=1);

// Plain PHP example (no framework): capture → save → send goal → verify webhook.
//   CLIKGATE_API_KEY=cg_test_… CLIKGATE_WEBHOOK_SECRET=whsec_… php -S localhost:8000 examples/plain/index.php

use Clikgate\Clikgate;
use Clikgate\Exception\SignatureVerificationException;
use Clikgate\Webhooks;

require __DIR__ . '/../../vendor/autoload.php';

$clikgate = new Clikgate(['sendMode' => 'after_response']); // the visitor never waits for Clikgate
$uri = $_SERVER['REQUEST_URI'] ?? '/';
$path = parse_url(is_string($uri) ? $uri : '/', \PHP_URL_PATH);
$store = sys_get_temp_dir() . '/clikgate-example-applications.json';
/** @var array<string, array{click_id: ?string}> $applications */
$applications = is_file($store) ? (array) json_decode((string) file_get_contents($store), true) : [];

if ('/webhooks/clikgate' === $path) {
    // 4. Verify Clikgate webhooks over the raw body
    $signature = is_string($_SERVER['HTTP_CLIKGATE_SIGNATURE'] ?? null) ? $_SERVER['HTTP_CLIKGATE_SIGNATURE'] : null;
    try {
        $event = Webhooks::verify((string) file_get_contents('php://input'), $signature, (string) getenv('CLIKGATE_WEBHOOK_SECRET'));
    } catch (SignatureVerificationException $e) {
        http_response_code(400);
        echo $e->getErrorCode();

        return;
    }
    error_log('clikgate event ' . (is_string($event['type'] ?? null) ? $event['type'] : '?')); // dedupe on $event['id']

    return;
}

if ('/cg/keep' === $path) {
    // Keep the click ID longer in Safari: the web script (data-server-endpoint="/cg/keep") posts it here, on the same
    // host as the website, and the server sets the cookie (204, empty, never a redirect)
    $method = is_string($_SERVER['REQUEST_METHOD'] ?? null) ? $_SERVER['REQUEST_METHOD'] : 'GET';
    $headers = [];
    foreach ($_SERVER as $k => $v) {
        if (is_string($k) && str_starts_with($k, 'HTTP_') && is_string($v)) {
            $headers[str_replace('_', '-', substr($k, 5))] = $v;
        }
    }
    $body = 'POST' === $method ? (string) file_get_contents('php://input', false, null, 0, 1025) : '';
    $out = $clikgate->clickIds->keepRouteCore(['days' => 90])->respond($method, $headers, $body);
    http_response_code($out['status']);
    foreach ($out['headers'] as [$name, $value]) {
        header("{$name}: {$value}", false);
    }

    return;
}

if ('/applications' === $path) {
    // 1 + 2. Capture the click ID (query, cookie or header) and save it with your own record
    $clickId = $clikgate->clickIds->fromRequest();
    $id = 'APP-' . (55231 + count($applications));
    $applications[$id] = ['click_id' => $clickId];
    file_put_contents($store, json_encode($applications));
    echo json_encode(['id' => $id]);

    return;
}

if (1 === preg_match('#^/applications/(APP-\d+)/approve$#', (string) $path, $m) && isset($applications[$m[1]])) {
    // 3. Later: send the goal (never throws; sent after the response)
    $clikgate->goal('account_opened', ['clickId' => $applications[$m[1]]['click_id'], 'reference' => $m[1], 'value' => '2000000', 'currency' => 'NGN']);
    echo json_encode(['approved' => true]);

    return;
}

// Landing page: keep a ?cgid=… in the first-party cookie the web script also reads (plus the _cg_kept=s marker)
$clickId = $clikgate->clickIds->fromQuery();
if (null !== $clickId) {
    $clikgate->clickIds->persist(null, $clickId, ['days' => 90]);
}
echo 'Welcome';
