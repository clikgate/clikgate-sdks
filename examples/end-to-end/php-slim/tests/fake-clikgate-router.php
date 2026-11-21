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
    1 === preg_match('#^/v1/referral-programs/[^/]+/referrers$#', $path) => referrer($state, rawurldecode(explode('/', $path)[3]), (string) ($body['customer_user_id'] ?? '')),
    default => [404, ['error' => ['code' => 'not_found', 'message' => 'Not in the fake.']]],
};

file_put_contents($log, json_encode($state));
http_response_code($status);
header('Content-Type: application/json');
echo json_encode($answer);

/** Same customer, same referrer and code: 201 the first time, 200 after that, like the API. */
function referrer(array &$state, string $programId, string $customerUserId): array
{
    $created = !isset($state['codes'][$customerUserId]);
    $n = $state['codes'][$customerUserId] ??= \count($state['codes']) + 1;

    return [$created ? 201 : 200, referrerObject($n, $programId, $customerUserId)];
}

/** A referrer as the API returns it (`POST /v1/referral-programs/{id}/referrers`). */
function referrerObject(int $n, string $programId, string $customerUserId): array
{
    $code = "TANGO{$n}";

    return [
        'id' => "rfr_01JCK8Z9V7Q4M2N6P8R0S2T4R{$n}",
        'object' => 'referrer',
        'program_id' => $programId,
        'customer_user_id' => $customerUserId,
        'display_name' => null,
        'code' => $code,
        'external_code' => null,
        'link_id' => 'lnk_01JCK8Z9V7Q4M2N6P8R0S2T4AA',
        'url' => "https://go.example.com/r/{$code}",
        'short_url' => 'https://go.example.com/' . strtolower($code),
        'status' => 'active',
        'blocked_reason' => null,
        'blocked_at' => null,
        'stats' => ['clicks' => 0, 'installs' => 0, 'signups' => 0, 'in_progress' => 0, 'qualified' => 0, 'disqualified' => 0, 'rejected' => 0, 'referee_uninstall_rate_7d' => null],
        'attributes' => new stdClass(),
        'leaderboard_opt_out' => false,
        'quality_score' => null,
        'quality_band' => null,
        'last_activity_at' => null,
        'created_at' => '2026-11-02T09:30:00Z',
        'updated_at' => '2026-11-02T09:30:00Z',
        'livemode' => false,
    ];
}
