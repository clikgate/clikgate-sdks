<?php

declare(strict_types=1);

/*
 * The PHP conformance runner (server/conformance/README.md, "Runner protocol").
 * Starts the shared mock server, runs every case for language "php" and lets the mock judge each one.
 *
 *   php tests/Conformance/runner.php [--filter <substring>] [--verbose]
 */

use Clikgate\Clikgate;
use Clikgate\Core;
use Clikgate\Enum\Provider;
use Clikgate\ErrorContext;
use Clikgate\Exception\ClikgateException;
use Clikgate\Exception\InvalidRequestException;
use Clikgate\Exception\PermissionException;
use Clikgate\Exception\PrivateModeFieldRejectedException;
use Clikgate\Exception\RateLimitException;
use Clikgate\Exception\ServerException;
use Clikgate\HashForAds;
use Clikgate\Http\Clock;
use Clikgate\Money;
use Psr\Log\AbstractLogger;
use Psr\Log\LogLevel;

require __DIR__ . '/../../vendor/autoload.php';

foreach (['CLIKGATE_API_KEY', 'CLIKGATE_BASE_URL', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'] as $k) {
    putenv($k);
    unset($_ENV[$k], $_SERVER[$k]);
}

$argv = $_SERVER['argv'] ?? [];
$filterAt = array_search('--filter', $argv, true);
$filter = false !== $filterAt ? ($argv[$filterAt + 1] ?? null) : null;
$verbose = in_array('--verbose', $argv, true);

final class FakeClock implements Clock
{
    /** @var list<int> */
    public array $sleeps = [];

    public function __construct(public int $now) {}

    public function nowMs(): int
    {
        return $this->now;
    }

    public function sleepMs(int $ms): void
    {
        $this->sleeps[] = $ms;
    }
}

final class CaptureLogger extends AbstractLogger
{
    /** @var list<string> */
    public array $warnings = [];
    /** @var list<string> */
    public array $logs = [];

    public function log($level, string|Stringable $message, array $context = []): void
    {
        $code = $context['clikgate_code'] ?? null;
        if (LogLevel::WARNING === $level && is_string($code)) {
            $this->warnings[] = $code;
        }
        $this->logs[] = $message . ' ' . (is_string($code) ? $code : '');
    }
}

function startMock(): array
{
    $mock = realpath(__DIR__ . '/../../../conformance/mock-server/server.mjs');
    $node = trim((string) shell_exec('command -v node'));
    if ('' === $node || false === $mock) {
        fwrite(STDERR, "conformance: Node 18+ must be on the PATH to start the mock server\n");
        exit(1);
    }
    $proc = proc_open([$node, $mock, '--port', '0'], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => STDERR], $pipes);
    if (!is_resource($proc)) {
        exit(1);
    }
    while (($line = fgets($pipes[1])) !== false) {
        if (preg_match('/^CLIKGATE_MOCK_READY (.*)$/', trim($line), $m)) {
            $port = json_decode($m[1], true)['port'];

            return [$proc, "http://127.0.0.1:{$port}", $pipes];
        }
    }
    fwrite(STDERR, "conformance: the mock server exited before it was ready\n");
    exit(1);
}

function control(string $base, string $path, mixed $body = null): array
{
    $ch = curl_init("{$base}/__control{$path}");
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_PROXY => '']);
    if (null !== $body) {
        curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION), CURLOPT_HTTPHEADER => ['content-type: application/json']]);
    }
    $out = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    if (!is_string($out) || 200 !== $status) {
        throw new RuntimeException("control {$path}: HTTP {$status} " . (is_string($out) ? $out : ''));
    }

    return json_decode($out, true, 512, JSON_THROW_ON_ERROR);
}

function decode(mixed $v): mixed
{
    if (!is_array($v)) {
        return $v;
    }
    if (1 === count($v) && !array_is_list($v)) {
        $k = array_key_first($v);
        $x = $v[$k];
        switch ($k) {
            case '$decimal': return (string) $x;
            case '$float': return is_string($x) ? ('NaN' === $x ? NAN : ('-Infinity' === $x ? -INF : INF)) : (float) $x;
            case '$bigint': return (int) $x;
            case '$datetime': return new DateTimeImmutable((string) $x);
            case '$bytes_base64': return base64_decode((string) $x, true);
        }
    }

    return array_map(decode(...), $v);
}

function serialiseError(Throwable $e): array
{
    if ($e instanceof ClikgateException) {
        return [
            'class' => Core::canonical($e),
            'code' => $e->getErrorCode(),
            'http_status' => $e->getHttpStatus(),
            'param' => $e->getParam(),
            'request_id' => $e->getRequestId(),
            'type' => $e->getErrorType(),
            'retry_after' => $e instanceof RateLimitException || $e instanceof ServerException ? $e->getRetryAfter() : null,
            'field' => $e instanceof PrivateModeFieldRejectedException ? $e->getField() : null,
            'index' => $e instanceof InvalidRequestException ? $e->getIndex() : null,
            'allowed' => $e instanceof InvalidRequestException ? $e->getAllowed() : null,
            'doc_url' => $e instanceof InvalidRequestException ? $e->getDocUrl() : null,
            'required_plan' => $e instanceof PermissionException ? $e->getRequiredPlan() : null,
            'limit' => $e instanceof PermissionException ? $e->getLimit() : null,
            'message' => $e->getMessage(),
        ];
    }
    $short = substr((string) strrchr('\\' . $e::class, '\\'), 1);

    return ['class' => $short, 'code' => null, 'message' => $e->getMessage()];
}

const CAMEL = ['click_id' => 'clickId', 'is_first' => 'isFirst', 'occurred_at' => 'occurredAt', 'kept_by' => 'keptBy', 'browser_engine' => 'browserEngine', 'hashed_email' => 'hashedEmail', 'hashed_phone_e164' => 'hashedPhoneE164', 'hashed_phone_digits' => 'hashedPhoneDigits'];

function goalOptions(array $a): array
{
    $out = [];
    foreach ($a as $k => $v) {
        if ('key' === $k || 'goal' === $k || 'idempotency_key' === $k) {
            continue;
        }
        $out[CAMEL[$k] ?? $k] = 'provider' === $k ? asProvider($v) : $v;
    }

    return $out;
}

/** A known provider string becomes the Provider case (the enum path); others stay strings. */
function asProvider(mixed $v): mixed
{
    return is_string($v) ? (Provider::tryFrom($v) ?? $v) : $v;
}

const PAYMENT_CAMEL = ['amount_minor' => 'amountMinor', 'occurred_at' => 'occurredAt', 'click_id' => 'clickId'];

function paymentOptions(array $a): array
{
    $out = [];
    foreach ($a as $k => $v) {
        if ('idempotency_key' !== $k) {
            $out[PAYMENT_CAMEL[$k] ?? $k] = 'provider' === $k ? asProvider($v) : $v;
        }
    }

    return $out;
}

function helperOptions(array $a): array
{
    return array_filter(['goal' => $a['goal'] ?? null, 'clickId' => $a['click_id'] ?? null], static fn($v) => null !== $v);
}

/** The helpers take an array or JSON text; any other JSON value goes as its JSON text. */
function helperInput(mixed $response): array|string
{
    return is_array($response) || is_string($response) ? $response : json_encode($response, JSON_THROW_ON_ERROR);
}

function cookieOptions(array $a): array
{
    $o = [];
    foreach (['days', 'secure', 'domain'] as $k) {
        if (isset($a[$k])) {
            $o[$k] = $a[$k];
        }
    }

    return $o;
}

/** JSON-ready: empty PHP arrays from JSON objects stay objects in the judge's eyes only if they were objects. */
function canonical(mixed $v): mixed
{
    return $v;
}

function runCase(string $base, array $c): array
{
    $clock = new FakeClock($c['now_ms']);
    $logger = new CaptureLogger();
    $onError = [];
    $draw = 0;
    $rand = $c['random'] ?: [0.5];
    $cl = $c['client'];
    $options = [
        'baseUrl' => $cl['base_url'],
        'timeout' => $cl['timeout_ms'] / 1000,
        'maxRetries' => $cl['max_retries'],
        'sendMode' => $cl['send_mode'],
        'privateMode' => $cl['private_mode'],
        'batchSize' => $cl['batch_size'],
        'flushInterval' => $cl['flush_interval_ms'] / 1000,
        'maxQueueSize' => $cl['max_queue_size'],
        'shutdownHooks' => false,
        'logger' => $logger,
        'clock' => $clock,
        'random' => static function () use (&$draw, $rand): float {
            $r = $rand[$draw % count($rand)];
            ++$draw;

            return (float) $r;
        },
        'onError' => static function (ClikgateException $e, ErrorContext $ctx) use (&$onError): void {
            $onError[] = serialiseError($e) + ['events' => $ctx->events, 'dropped' => $ctx->dropped, 'operation' => $ctx->operation];
        },
    ];
    if (null !== $cl['api_key']) {
        $options['apiKey'] = $cl['api_key'];
    }
    if (null !== $cl['click_id_param']) {
        $options['clickIdParam'] = $cl['click_id_param'];
    }
    $outcome = static function (array $steps, ?array $constructError = null) use (&$onError, $c, $clock, $logger): array {
        return [
            'case_id' => $c['id'], 'language' => 'php', 'construct_error' => $constructError, 'steps' => $steps,
            'sleeps_ms' => $clock->sleeps, 'warnings' => $logger->warnings, 'logs' => $logger->logs, 'on_error' => $onError,
        ];
    };
    try {
        $client = new Clikgate($options);
    } catch (Throwable $e) {
        return control($base, '/finish', $outcome([], serialiseError($e)));
    }
    $steps = [];
    foreach ($c['steps'] as $step) {
        $a = decode($step['args'] ?? []);
        $ro = isset($a['idempotency_key']) ? ['idempotencyKey' => $a['idempotency_key']] : [];
        try {
            $result = match ($step['call']) {
                'client.mode' => ['value' => $client->mode],
                'goal' => (static function () use ($client, $a) {
                    $client->goal((string) ($a['key'] ?? ''), goalOptions($a));
                    return null;
                })(),
                'goals.send' => $client->goals->send((string) $a['key'], goalOptions($a), $ro),
                'goals.send_batch' => $client->goals->sendBatch(array_map(static fn(array $e): array => ['goal' => $e['goal'] ?? null] + goalOptions($e), $a['events'])),
                'goals.reverse' => $client->goals->reverse((string) $a['key'], (string) ($a['reference'] ?? ''), array_filter(['value' => $a['value'] ?? null, 'reason' => $a['reason'] ?? null], static fn($v) => null !== $v)),
                'flush' => ['value' => $client->flush(($a['timeout_ms'] ?? 10_000) / 1000)],
                'close' => ['value' => $client->close(($a['timeout_ms'] ?? 10_000) / 1000)],
                'advance_clock' => (static function () use ($clock, $a) {
                    $clock->now += $a['ms'];
                    return null;
                })(),
                'config.get' => $client->config(),
                'conversions.create' => $client->conversions->create($a['params'] ?? [], $ro),
                'conversions.reverse' => $client->conversions->reverse((string) $a['id'], $a['params'] ?? []),
                'links.create' => $client->links->create($a['params'] ?? [], $ro),
                'links.get' => $client->links->get((string) $a['id']),
                'links.update' => $client->links->update((string) $a['id'], $a['params'] ?? [], $ro),
                'links.list' => (static function () use ($client, $a): array {
                    $items = [];
                    foreach ($client->links->list($a['params'] ?? []) as $link) {
                        $items[] = $link;
                        if (isset($a['max_items']) && count($items) >= $a['max_items']) {
                            break;
                        }
                    }

                    return ['items' => $items];
                })(),
                'links.list_page' => $client->links->listPage($a['params'] ?? []),
                'links.qr' => (static function () use ($client, $a): array {
                    $q = $a;
                    unset($q['id']);
                    $qr = $client->links->qr((string) $a['id'], $q);

                    return ['content_type' => $qr->contentType, 'bytes_length' => strlen($qr->data)];
                })(),
                'clicks.get' => $client->clicks->get((string) $a['id']),
                'webhooks.verify' => (static fn() => \Clikgate\Webhooks::verify($a['raw_body'], $a['header'] ?? null, (string) $a['secret'], (int) $a['tolerance'], (int) $a['now']))(),
                'webhooks.verify_any' => (static fn() => \Clikgate\Webhooks::verifyAny($a['raw_body'], $a['header'] ?? null, $a['secrets'], (int) $a['tolerance'], (int) $a['now']))(),
                'click_ids.is_valid' => ['value' => $client->clickIds->isValid($a['id'] ?? null)],
                'click_ids.from_request' => ['value' => $client->clickIds->fromRequest(['url' => $a['request']['url'], 'headers' => $a['request']['headers'] ?? []])],
                'click_ids.cookie_header' => ['value' => $client->clickIds->cookieHeader((string) $a['id'], cookieOptions($a))],
                'click_ids.persist' => (static function () use ($client, $a): array {
                    $lines = array_map(static fn(string $v): string => "Set-Cookie: {$v}", $a['existing_set_cookie'] ?? []);
                    $lines = $client->clickIds->persist($lines, (string) $a['id'], cookieOptions($a));

                    return ['set_cookie' => array_map(static fn(string $l): string => substr($l, strlen('Set-Cookie: ')), $lines)];
                })(),
                'click_ids.from_payment_metadata' => ['value' => $client->clickIds->fromPaymentMetadata($a['payload'] ?? null)],
                'click_ids.context' => (static function () use ($client, $a): array {
                    $c = $client->clickIds->context(['url' => $a['request']['url'], 'headers' => $a['request']['headers'] ?? []]);

                    return ['click_id' => $c['clickId'], 'kept_by' => $c['keptBy'], 'browser_engine' => $c['browserEngine'], 'platform' => $c['platform']];
                })(),
                'click_ids.keep' => (static function () use ($client, $a): array {
                    $r = $a['request'];
                    $factory = new \Nyholm\Psr7\Factory\Psr17Factory();
                    $request = new \Nyholm\Psr7\ServerRequest((string) $r['method'], (string) $r['url'], (array) ($r['headers'] ?? []), (string) ($r['body'] ?? ''));
                    $response = $client->clickIds->keepRoute(cookieOptions($a), $factory)->handle($request);
                    $out = [
                        'status' => $response->getStatusCode(),
                        'cache_control' => $response->getHeaderLine('Cache-Control'),
                        'set_cookie' => $response->getHeader('Set-Cookie'),
                        'body' => (string) $response->getBody(),
                        'location' => $response->hasHeader('Location') ? $response->getHeaderLine('Location') : null,
                    ];
                    if ($response->hasHeader('Allow')) {
                        $out['allow'] = $response->getHeaderLine('Allow');
                    }

                    return $out;
                })(),
                'identify_user' => $client->identifyUser(array_filter([
                    'clickId' => $a['click_id'] ?? null,
                    'appId' => $a['app_id'] ?? null,
                    'installationId' => $a['installation_id'] ?? null,
                    'customerId' => $a['customer_id'] ?? null,
                    'label' => $a['label'] ?? null,
                ], static fn($v) => null !== $v), $ro),
                'payments.confirm' => $client->payments->confirm(paymentOptions($a), $ro),
                'payments.from' => (static function () use ($client, $a) {
                    $method = 'from' . ucfirst((string) $a['gateway']);

                    return $client->payments->{$method}(helperInput($a['response'] ?? null), helperOptions($a));
                })(),
                'payments.build' => (static function () use ($client, $a): array {
                    $method = 'buildFrom' . ucfirst((string) $a['gateway']);

                    return ['value' => $client->payments->{$method}(helperInput($a['response'] ?? null), helperOptions($a))];
                })(),
                'money.format' => ['value' => Money::formatValue($a['value'] ?? null)],
                'hash_for_ads' => (static function () use ($a): array {
                    $out = [];
                    foreach (HashForAds::hash($a['email'] ?? null, $a['phone'] ?? null) as $option => $v) {
                        $out[HashForAds::FIELDS[$option]] = $v;
                    }

                    return $out;
                })(),
                default => throw new RuntimeException("runner: unknown call {$step['call']}"),
            };
            $steps[] = ['result' => $result];
        } catch (Throwable $e) {
            $steps[] = ['error' => serialiseError($e)];
        }
    }
    $verdict = control($base, '/finish', $outcome($steps));
    $client->close(1.0);

    return $verdict;
}

[$proc, $base, $pipes] = startMock();
$passed = $failed = 0;
try {
    $cases = control($base, '/cases?language=php')['cases'];
    foreach ($cases as $c) {
        if (null !== $filter && !str_contains($c['id'], $filter)) {
            continue;
        }
        $started = control($base, '/start', ['case_id' => $c['id']]);
        $verdict = runCase($base, $started);
        if ($verdict['ok']) {
            ++$passed;
            if ($verbose) {
                echo "ok   {$c['id']}\n";
            }
        } else {
            ++$failed;
            echo "FAIL {$c['id']}: {$c['description']}\n  - " . implode("\n  - ", $verdict['failures']) . "\n";
        }
    }
} finally {
    proc_terminate($proc);
}
$total = $passed + $failed;
echo "\nconformance (php): {$passed} passed, {$failed} failed, {$total} total\n";
exit($failed > 0 || 0 === $passed ? 1 : 0);
