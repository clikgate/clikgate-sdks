<?php

declare(strict_types=1);

/*
 * A local stand-in for the Clikgate API, so the test never calls the real one. FakeClikgate runs it with PHP's
 * built-in server. It answers the calls the backend makes with the API's response shapes, and appends every request
 * to the JSON file named by FAKE_CLIKGATE_LOG for the test to check.
 */

$log = (string) getenv('FAKE_CLIKGATE_LOG');
$path = (string) parse_url($_SERVER['REQUEST_URI'], \PHP_URL_PATH);
$body = json_decode((string) file_get_contents('php://input'), true) ?: [];
$state = json_decode((string) @file_get_contents($log), true) ?: ['requests' => [], 'codes' => []];
$state['requests'][] = ['method' => $_SERVER['REQUEST_METHOD'], 'path' => $path, 'authorization' => $_SERVER['HTTP_AUTHORIZATION'] ?? null, 'body' => $body];

[$status, $answer] = match (true) {
    '/v1/server-sdk/config' === $path => [200, ['mode' => 'test', 'private_mode' => false, 'goals' => [['key' => 'account_opened'], ['key' => 'order_paid']]]],
    '/v1/people/identify' === $path => [200, ['object' => 'person_identified', 'person_id' => 'per_fake']],
    '/v1/goals/events' === $path => [201, ['object' => 'goal_event', 'id' => 'cnv_fake', 'status' => 'counted']],
    '/v1/goals/events/batch' === $path => [200, ['object' => 'list', 'data' => array_map(
        static fn(int $i): array => ['index' => $i, 'ok' => true, 'status' => 201, 'goal_event' => ['object' => 'goal_event', 'status' => 'counted']],
        array_keys($body['events'] ?? []),
    )]],
    '/v1/payments/confirmations' === $path => [201, $body + ['object' => 'payment_confirmation', 'id' => 'pcf_fake', 'match_status' => 'matched', 'duplicate' => false]],
    1 === preg_match('#^/v1/referral-programs/[^/]+/referrers$#', $path) => referrer($state, (string) ($body['customer_user_id'] ?? '')),
    default => [404, ['error' => ['code' => 'not_found', 'message' => 'Not in the fake.']]],
};

file_put_contents($log, json_encode($state));
http_response_code($status);
header('Content-Type: application/json');
echo json_encode($answer);

/** Same customer, same code: 201 the first time, 200 after that, like the API. */
function referrer(array &$state, string $customerUserId): array
{
    $created = !isset($state['codes'][$customerUserId]);
    $code = $state['codes'][$customerUserId] ??= 'TANGO-' . (\count($state['codes']) + 1);

    return [$created ? 201 : 200, ['object' => 'referrer', 'code' => $code, 'customer_user_id' => $customerUserId, 'short_url' => "https://go.example.com/r/{$code}"]];
}
