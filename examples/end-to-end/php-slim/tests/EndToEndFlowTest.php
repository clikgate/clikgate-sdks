<?php

declare(strict_types=1);

namespace App\Tests;

use App\AppFactory;
use App\Config;
use App\State;
use App\Webhooks\RewardStore;
use Clikgate\Clikgate;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;
use Slim\App;
use Slim\Psr7\Factory\ServerRequestFactory;

/** The whole flow, from sign-up to a paid referral reward, against a fake Clikgate API. */
final class EndToEndFlowTest extends TestCase
{
    private const WEBHOOK_SECRET = 'whsec_test_sample_only';
    private const INSTALLATION = 'app_01JAB3C4D5E6F7G8H9JKMNPQRS:6a1f0c2e-4b7d-4c1a-9e2f-0d3b5a7c9e11';

    private FakeClikgate $clikgateApi;
    private string $stateFile;
    private App $app;
    private Clikgate $clikgate;
    private RewardStore $rewards;

    protected function setUp(): void
    {
        $this->clikgateApi = new FakeClikgate();
        $this->stateFile = (string) tempnam(sys_get_temp_dir(), 'sample-state-');
        $config = new Config('cg_test_sample_only', $this->clikgateApi->url, 'test-identity-secret-sample-only', self::WEBHOOK_SECRET, 'rpg_test_sample');
        ['app' => $this->app, 'clikgate' => $this->clikgate, 'rewards' => $this->rewards] = AppFactory::create($config, new State($this->stateFile));
    }

    protected function tearDown(): void
    {
        $this->clikgateApi->stop();
        @unlink($this->stateFile);
    }

    public function testFullFlow(): void
    {
        // 1. Sign-up: the token carries the account date, and Path B identifies the installation from the header.
        $signUp = $this->call('POST', '/auth/sign-up', ['email' => 'ada@example.com', 'password' => 'correct horse']);
        self::assertSame(201, $signUp->getStatusCode());
        $session = self::json($signUp);
        $userId = $session['user']['id'];
        $createdAt = (new \DateTimeImmutable($session['user']['createdAt']))->getTimestamp();
        self::assertTokenHasAccountDate($session['clikgateIdentityToken'], $createdAt);

        $identify = $this->clikgateApi->bodiesSentTo('/v1/people/identify')[0];
        self::assertSame('6a1f0c2e-4b7d-4c1a-9e2f-0d3b5a7c9e11', $identify['installation_id']);
        self::assertSame('app_01JAB3C4D5E6F7G8H9JKMNPQRS', $identify['app_id']);
        self::assertSame($userId, $identify['customer_id']);
        self::assertNotEmpty($identify['customer_since']);

        // 2. Sign-in: wrong password refused, right password gets a fresh token.
        self::assertSame(401, $this->call('POST', '/auth/sign-in', ['email' => 'ada@example.com', 'password' => 'nope'])->getStatusCode());
        $signIn = $this->call('POST', '/auth/sign-in', ['email' => 'ada@example.com', 'password' => 'correct horse']);
        self::assertTokenHasAccountDate(self::json($signIn)['clikgateIdentityToken'], $createdAt);

        // 3. /me needs the session, and returns a token too.
        $accessToken = $session['accessToken'];
        self::assertSame(401, $this->call('GET', '/me')->getStatusCode());
        self::assertTokenHasAccountDate(self::json($this->call('GET', '/me', null, $accessToken))['clikgateIdentityToken'], $createdAt);

        // 4. The server goal from sign-up waits for the end of the request (after_response); flushing sends it.
        self::assertTrue($this->clikgate->flush());
        $goals = json_encode(array_merge($this->clikgateApi->bodiesSentTo('/v1/goals/events'), $this->clikgateApi->bodiesSentTo('/v1/goals/events/batch')));
        self::assertStringContainsString('account_opened', (string) $goals);
        self::assertStringContainsString($userId, (string) $goals);

        // 5. Payment: confirmed from the (stubbed) gateway's answer, in normal units.
        self::assertSame(200, $this->call('POST', '/payments/paystack/confirm', ['reference' => 'T123456'], $accessToken)->getStatusCode());
        $confirmation = $this->clikgateApi->bodiesSentTo('/v1/payments/confirmations')[0];
        self::assertSame(['paystack', 'T123456', '7500', 'NGN', 'order_paid'], [$confirmation['provider'], $confirmation['reference'], $confirmation['amount'], $confirmation['currency'], $confirmation['goal']]);

        // 6. Referral code: the same code on every call.
        $first = self::json($this->call('GET', '/me/referral', null, $accessToken));
        $second = self::json($this->call('GET', '/me/referral', null, $accessToken));
        self::assertNotEmpty($first['code']);
        self::assertSame($first['code'], $second['code']);
        self::assertStringStartsWith('https://', $first['link']);
        self::assertSame($userId, $this->clikgateApi->bodiesSentTo('/v1/referral-programs/rpg_test_sample/referrers')[0]['customer_user_id']);

        // Every call to the API used the server key.
        foreach ($this->clikgateApi->requests() as $request) {
            self::assertSame('Bearer cg_test_sample_only', $request['authorization']);
        }

        // 7. Webhooks: verified, deduplicated, and the reward is paid once.
        self::assertSame(200, $this->webhook('evt_1', 'referral.qualified', 'ref_1', $userId));
        self::assertSame(200, $this->webhook('evt_1', 'referral.qualified', 'ref_1', $userId)); // redelivery
        self::assertSame(200, $this->webhook('evt_2', 'referral.qualified', 'ref_1', $userId)); // same referral
        self::assertSame(1, $this->rewards->paidCount());
        self::assertSame($userId, $this->rewards->find('ref_1')['referrer_user_id']);

        self::assertSame(200, $this->webhook('evt_3', 'referral.disqualified', 'ref_2', $userId));
        self::assertSame('disqualified', $this->rewards->find('ref_2')['status']);
        self::assertSame(400, $this->webhook('evt_4', 'referral.qualified', 'ref_3', $userId, 'whsec_wrong'));
        self::assertNull($this->rewards->find('ref_3'));
        self::assertSame(1, $this->rewards->paidCount());
    }

    /** A version 2 token ends with the account date in Unix seconds: <signature>.<issued at>.<customer since> */
    private static function assertTokenHasAccountDate(string $token, int $createdAtSeconds): void
    {
        $parts = explode('.', $token);
        self::assertCount(3, $parts);
        self::assertSame((string) $createdAtSeconds, $parts[2]);
    }

    /** @param array<string, mixed>|null $body */
    private function call(string $method, string $path, ?array $body = null, ?string $accessToken = null): ResponseInterface
    {
        $request = (new ServerRequestFactory())->createServerRequest($method, $path)
            ->withHeader('Content-Type', 'application/json')
            ->withHeader('Clikgate-Installation', self::INSTALLATION);
        if (null !== $accessToken) {
            $request = $request->withHeader('Authorization', "Bearer {$accessToken}");
        }
        if (null !== $body) {
            $request->getBody()->write(json_encode($body, \JSON_THROW_ON_ERROR));
        }

        return $this->app->handle($request);
    }

    private function webhook(string $eventId, string $type, string $referralId, string $referrerUserId, string $secret = self::WEBHOOK_SECRET): int
    {
        $referral = ['id' => $referralId, 'referrer' => ['customer_user_id' => $referrerUserId], 'referee' => ['customer_user_id' => 'user_friend']];
        $body = json_encode(['id' => $eventId, 'type' => $type, 'data' => ['object' => $referral]], \JSON_THROW_ON_ERROR);
        $t = time();
        $signature = hash_hmac('sha256', "{$t}.{$body}", $secret);
        $request = (new ServerRequestFactory())->createServerRequest('POST', '/webhooks/clikgate')
            ->withHeader('Content-Type', 'application/json')
            ->withHeader('Clikgate-Signature', "t={$t},v1={$signature}");
        $request->getBody()->write($body);

        return $this->app->handle($request)->getStatusCode();
    }

    /** @return array<string, mixed> */
    private static function json(ResponseInterface $response): array
    {
        return json_decode((string) $response->getBody(), true, flags: \JSON_THROW_ON_ERROR);
    }
}
