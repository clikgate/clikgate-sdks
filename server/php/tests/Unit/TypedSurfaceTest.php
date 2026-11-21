<?php

declare(strict_types=1);

namespace Clikgate\Tests\Unit;

use Clikgate\Clikgate;
use Clikgate\Currency;
use Clikgate\Enum\EventType;
use Clikgate\Exception\AuthenticationException;
use Clikgate\Model\Link;
use Clikgate\Model\Referral;
use Clikgate\Webhooks;
use Nyholm\Psr7\Response;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface;

final class TypedSurfaceTest extends TestCase
{
    private const KEY = 'cg_test_unit000000000000';
    private const SECRET = 'whsec_unit_typed';

    private function client(RecordingClient $http): Clikgate
    {
        return new Clikgate(['apiKey' => self::KEY, 'httpClient' => $http, 'shutdownHooks' => false, 'privateMode' => false, 'maxRetries' => 0]);
    }

    private static function json(int $status, mixed $body): \Closure
    {
        return static fn(): ResponseInterface => new Response($status, ['Content-Type' => 'application/json'], json_encode($body, \JSON_THROW_ON_ERROR));
    }

    public function testMinorToAmountUsesTheCurrencyExponent(): void
    {
        self::assertSame('500.00', Currency::minorToAmount(50000, 'NGN'));
        self::assertSame('0.05', Currency::minorToAmount(5, 'usd'));
        self::assertSame('1500', Currency::minorToAmount(1500, 'JPY'));
        self::assertSame('12.345', Currency::minorToAmount(12345, 'KWD'));
        self::assertSame('0.0001', Currency::minorToAmount(1, 'CLF'));
        self::assertSame('-2.50', Currency::minorToAmount(-250, 'NGN'));
        self::assertSame('92233720368547758.07', Currency::minorToAmount(\PHP_INT_MAX, 'NGN'));
    }

    public function testLinkModelKeepsArrayAccess(): void
    {
        $http = new RecordingClient(self::json(200, ['object' => 'link', 'id' => 'lnk_1', 'short_url' => 'https://ciz.to/a', 'warnings' => [['code' => 'no_preview', 'message' => 'x']], 'future' => ['a' => 1]]));
        $link = $this->client($http)->links->get('lnk_1');
        self::assertSame('https://ciz.to/a', $link->shortUrl);
        self::assertSame('https://ciz.to/a', $link['short_url']);
        self::assertTrue(isset($link['short_url']));
        self::assertFalse(isset($link['missing']));
        self::assertNull($link['missing']);
        $warnings = $link['warnings'];
        self::assertIsArray($warnings);
        self::assertSame(['a' => 1], $link['future']);
        self::assertSame('lnk_1', $link->toArray()['id']);
        self::assertSame('{"object":"link","id":"lnk_1","short_url":"https:\/\/ciz.to\/a","warnings":[{"code":"no_preview","message":"x"}],"future":{"a":1}}', json_encode($link));
        $this->expectException(\LogicException::class);
        $link['id'] = 'other';
    }

    public function testUpdateResultKeepsNestedArrayAccess(): void
    {
        $http = new RecordingClient(self::json(202, ['object' => 'link_change_request', 'id' => 'lcr_1', 'link_id' => 'lnk_1', 'status' => 'pending']));
        $result = $this->client($http)->links->update('lnk_1', ['destination_url' => 'https://example.com']);
        self::assertFalse($result->applied);
        self::assertFalse($result['applied']);
        self::assertSame('lcr_1', $result->changeRequest?->id);
        $cr = $result['change_request'];
        self::assertIsArray($cr);
        self::assertSame('lcr_1', $cr['id']);
        self::assertNull($result['link']);
    }

    public function testListYieldsLinks(): void
    {
        $http = new RecordingClient(self::json(200, ['object' => 'list', 'data' => [['object' => 'link', 'id' => 'lnk_1']], 'has_more' => false, 'next_cursor' => null]));
        $links = iterator_to_array($this->client($http)->links->list());
        self::assertCount(1, $links);
        self::assertInstanceOf(Link::class, $links[0]);
    }

    public function testReferralRewardAmountsAndTypedNames(): void
    {
        $http = new RecordingClient(self::json(200, [
            'object' => 'referral', 'id' => 'ref_1', 'status' => 'qualified',
            'referrer' => ['id' => 'rfr_1', 'customer_user_id' => 'user-42', 'code' => 'ADA42'],
            'referee' => ['install_id' => 'ins_1', 'installation_id' => 'i-1', 'customer_user_id' => null],
            'link' => ['id' => 'lnk_1'],
            'reward_snapshot' => ['referrer' => ['amount_minor' => 50000, 'currency' => 'NGN'], 'referee' => ['description' => 'A free month']],
        ]));
        $referral = $this->client($http)->referrals->get('ref_1');
        self::assertSame('user-42', $referral->referrer->customerId);
        self::assertSame('lnk_1', $referral->linkId);
        self::assertSame('500.00', $referral->reward?->referrer?->amount);
        self::assertNull($referral->reward->referee?->amount);
        $snapshot = $referral->toArray()['reward_snapshot'];
        self::assertIsArray($snapshot);
        self::assertSame(['amount_minor' => 50000, 'currency' => 'NGN', 'amount' => '500.00'], $snapshot['referrer']);
    }

    public function testGetOrCreateReferrerSetsCreated(): void
    {
        $http = new RecordingClient(self::json(201, ['object' => 'referrer', 'id' => 'rfr_1', 'customer_user_id' => 'user-42']));
        $referrer = $this->client($http)->referrals->getOrCreateReferrer('rpg_1', ['customerId' => 'user-42']);
        self::assertTrue($referrer->created);
        self::assertTrue($referrer['created']);
        self::assertSame('user-42', $referrer->customerId);
        self::assertSame([['customer_user_id' => 'user-42']], $http->bodies());
    }

    public function testFindReferrerIsNullOnlyOn404(): void
    {
        $http = new RecordingClient(self::json(404, ['error' => ['type' => 'not_found', 'code' => 'resource_missing', 'message' => 'No such referrer.']]));
        self::assertNull($this->client($http)->referrals->findReferrer('rpg_1', ['code' => 'ADA42']));
        $http = new RecordingClient(self::json(401, ['error' => ['type' => 'authentication', 'code' => 'invalid_api_key', 'message' => 'No.']]));
        $this->expectException(AuthenticationException::class);
        $this->client($http)->referrals->findReferrer('rpg_1', ['customerId' => 'user-42']);
    }

    public function testBlockWithoutReasonSendsAnEmptyObject(): void
    {
        $http = new RecordingClient(self::json(200, ['object' => 'referrer', 'id' => 'rfr_1']));
        $this->client($http)->referrals->blockReferrer('rfr_1');
        self::assertSame('{}', (string) $http->requests[0]->getBody());
    }

    private static function event(string $type, mixed $object): string
    {
        return json_encode(['id' => 'evt_1', 'object' => 'event', 'type' => $type, 'api_version' => '2026-10-01', 'created_at' => '2026-10-26T12:00:00Z', 'organization_id' => 'org_1', 'livemode' => false, 'data' => ['object' => $object, 'previous_attributes' => null]], \JSON_THROW_ON_ERROR);
    }

    private static function verify(string $body): \Clikgate\Model\WebhookEvent
    {
        $t = 1_793_016_000;

        return Webhooks::verify($body, "t={$t},v1=" . hash_hmac('sha256', "{$t}.{$body}", self::SECRET), self::SECRET, 300, $t);
    }

    public function testWebhookAccessors(): void
    {
        $event = self::verify(self::event('referral.qualified', ['object' => 'referral', 'id' => 'ref_1', 'reward_snapshot' => ['referrer' => ['amount_minor' => 1500, 'currency' => 'JPY']]]));
        self::assertSame(EventType::ReferralQualified, $event->eventType());
        self::assertSame(EventType::ReferralQualified, $event->type);
        self::assertSame(EventType::ReferralQualified, $event['type']);
        self::assertSame('referral.qualified', $event['type']);
        self::assertSame('2026-10-01', $event->apiVersion);
        $referral = $event->asReferral();
        self::assertInstanceOf(Referral::class, $referral);
        self::assertSame('1500', $referral->reward?->referrer?->amount);
        self::assertNull($event->asReferrer());
        self::assertNull($event->asGoalEvent());
        self::assertSame('lnk_1', self::verify(self::event('goal.completed', ['object' => 'goal_event', 'id' => 'cnv_1', 'link' => ['id' => 'lnk_1']]))->asGoalEvent()?->linkId);
        self::assertSame('ins_1', self::verify(self::event('install.organic', ['object' => 'install', 'id' => 'ins_1']))->asInstall()?->id);
        self::assertNull(self::verify(self::event('app.reengaged', ['object' => 'install', 'id' => 'ins_1']))->asInstall());
        self::assertSame('prp_1', self::verify(self::event('payment.verified', ['object' => 'payment_report', 'id' => 'prp_1']))->asPayment()?->id);
        self::assertSame('ORD-1', self::verify(self::event('conversion.attributed', ['object' => 'conversion', 'id' => 'cnv_2', 'external_id' => 'ORD-1']))->asConversion()?->externalId);
        self::assertNull(self::verify(self::event('referral.created', 'ref_1'))->asReferral());
        self::assertNull(self::verify(self::event('brand_new.type', []))->eventType());
    }

    public function testAsDeviceChange(): void
    {
        $object = ['object' => 'device_change', 'id' => 'dvc_1:switch', 'device_change_id' => 'dvc_1', 'person_id' => 'per_1', 'customer_id' => 'user-42', 'app_id' => 'app_1', 'kind' => 'switch', 'from' => ['platform' => 'android', 'device_model' => 'Pixel 7'], 'to' => ['platform' => 'ios', 'device_model' => null], 'from_last_seen_at' => null, 'to_first_open_at' => '2026-10-26T09:00:00Z', 'gap_days' => 2, 'livemode' => false];
        $change = self::verify(self::event('person.device_changed', $object))->asDeviceChange();
        self::assertNotNull($change);
        self::assertSame('android', $change->from->platform);
        self::assertSame(['platform' => 'ios', 'device_model' => null], $change['to']);
        self::assertSame(2, $change->gapDays);
        self::assertNull(self::verify(self::event('install.attributed', $object))->asDeviceChange());
    }

    public function testEventTypeHas97UniqueValues(): void
    {
        $values = EventType::all();
        self::assertCount(97, $values);
        self::assertCount(97, array_unique($values));
        self::assertSame('link.stats.hourly', EventType::LinkStatsHourly);
    }
}
