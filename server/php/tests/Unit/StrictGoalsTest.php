<?php

declare(strict_types=1);

namespace Clikgate\Tests\Unit;

use Clikgate\Clikgate;
use Clikgate\ErrorContext;
use Clikgate\Exception\ClikgateException;
use Clikgate\Exception\InvalidRequestException;
use Nyholm\Psr7\Response;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;

/**
 * "Allow unknown goal names" off: 422 unknown_goal and goal_archived are final (never retried), the SDK never
 * remembers a refusal, and a debug-level line names the goal only.
 */
final class StrictGoalsTest extends TestCase
{
    private const KEY = 'cg_test_unit000000000000';
    private const LINE = "Goal `level_complete` isn't set up in Clikgate";
    private const ENVELOPE = '{"error":{"type":"invalid_request","code":"unknown_goal","message":"This goal isn\'t set up in Clikgate.","param":"goal"},"status":"refused","reason":"unknown_goal","counted":false,"goal_kind":null}';
    private const REFUSAL = '{"status":"refused","reason":"unknown_goal","counted":false,"goal_kind":null}';

    protected function setUp(): void
    {
        putenv('CLIKGATE_API_KEY');
        putenv('CLIKGATE_BASE_URL');
    }

    private static function logger(): RecordingLogger
    {
        return new RecordingLogger();
    }

    /** @param list<array{int, string}> $answers */
    private static function http(array $answers): RecordingClient
    {
        return new RecordingClient(static function () use (&$answers): ResponseInterface {
            [$status, $body] = \count($answers) > 1 ? array_shift($answers) : $answers[0];

            return new Response($status, ['Content-Type' => 'application/json'], $body);
        });
    }

    /** @param array<string, mixed> $options */
    private function client(RecordingClient $http, array $options = []): Clikgate
    {
        return new Clikgate(['apiKey' => self::KEY, 'httpClient' => $http, 'shutdownHooks' => false, 'privateMode' => false, 'maxRetries' => 3] + $options);
    }

    public function testUnknownGoalIsFinalAndLoggedAtDebugWithTheNameOnly(): void
    {
        $http = self::http([[422, self::ENVELOPE]]);
        $log = self::logger();
        try {
            $this->client($http, ['logger' => $log])->goals->send('level_complete', ['reference' => 'APP-77120', 'value' => '2500', 'label' => 'Ada']);
            self::fail('expected an exception');
        } catch (InvalidRequestException $e) {
            self::assertSame('unknown_goal', $e->getErrorCode());
            self::assertSame(422, $e->getHttpStatus());
        }
        self::assertCount(1, $http->requests);
        self::assertSame([self::LINE], $log->debugLines());
        foreach ($log->lines as [, $m]) {
            self::assertStringNotContainsString('APP-77120', $m);
            self::assertStringNotContainsString('2500', $m);
            self::assertStringNotContainsString('Ada', $m);
        }
    }

    public function testRefusalBodyMapsToItsReason(): void
    {
        $http = self::http([[422, self::REFUSAL], [422, '{"status":"refused","reason":"goal_archived"}']]);
        $log = self::logger();
        $c = $this->client($http, ['logger' => $log]);
        foreach ([['level_complete', 'unknown_goal'], ['old_signup', 'goal_archived']] as [$goal, $code]) {
            try {
                $c->goals->send($goal, ['reference' => 'APP-1']);
                self::fail('expected an exception');
            } catch (InvalidRequestException $e) {
                self::assertSame($code, $e->getErrorCode());
                self::assertSame(422, $e->getHttpStatus());
            }
        }
        self::assertCount(2, $http->requests);
        self::assertSame([self::LINE], $log->debugLines());
    }

    public function testTheNameIsNeverRemembered(): void
    {
        $http = self::http([[422, self::ENVELOPE], [201, '{"object":"goal_event","status":"counted"}']]);
        $c = $this->client($http, ['logger' => self::logger()]);
        try {
            $c->goals->send('level_complete', ['reference' => 'APP-1']);
            self::fail('expected an exception');
        } catch (InvalidRequestException) {
        }
        self::assertSame('counted', $c->goals->send('level_complete', ['reference' => 'APP-2'])['status']);
        self::assertCount(2, $http->requests);
    }

    public function testBatchAndBackgroundItems(): void
    {
        $answer = '{"object":"list","data":[{"index":0,"ok":true,"status":201,"goal_event":{"object":"goal_event","status":"counted","reason":null},"error":null},'
            . '{"index":1,"ok":false,"status":422,"goal_event":null,"error":{"type":"invalid_request","code":"unknown_goal","message":"x","param":"goal"}}]}';
        $http = self::http([[200, $answer]]);
        $log = self::logger();
        $result = $this->client($http, ['logger' => $log])->goals->sendBatch([['goal' => 'order_paid', 'reference' => 'R-0'], ['goal' => 'level_complete', 'reference' => 'APP-77120']]);
        $items = $result['data'];
        self::assertIsArray($items);
        self::assertIsArray($items[1]);
        self::assertFalse($items[1]['ok']);

        $errors = [];
        $bg = $this->client($http, ['logger' => $log, 'sendMode' => 'background', 'onError' => static function (ClikgateException $e, ErrorContext $ctx) use (&$errors): void {
            $errors[] = [$e->getErrorCode(), $ctx->dropped];
        }]);
        $bg->goal('order_paid', ['reference' => 'R-0']);
        $bg->goal('level_complete', ['reference' => 'APP-77120', 'value' => '2500']);
        self::assertTrue($bg->flush(1.0));
        self::assertTrue($bg->flush(1.0));
        self::assertCount(2, $http->requests);
        self::assertSame([['unknown_goal', true]], $errors);
        self::assertSame([self::LINE, self::LINE], $log->debugLines());
    }

    public function testSyncGoalLogsTheLine(): void
    {
        $http = self::http([[422, self::REFUSAL]]);
        $log = self::logger();
        $errors = [];
        $c = $this->client($http, ['logger' => $log, 'sendMode' => 'sync', 'onError' => static function (ClikgateException $e) use (&$errors): void {
            $errors[] = $e->getErrorCode();
        }]);
        $c->goal('level_complete', ['reference' => 'APP-1']);
        self::assertSame(['unknown_goal'], $errors);
        self::assertSame([self::LINE], $log->debugLines());
        self::assertCount(1, $http->requests);
    }
}
