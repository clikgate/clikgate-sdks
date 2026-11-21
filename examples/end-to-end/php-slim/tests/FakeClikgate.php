<?php

declare(strict_types=1);

namespace App\Tests;

/** Starts the fake Clikgate API (tests/fake-clikgate-router.php) on a free local port, and reads what it received. */
final class FakeClikgate
{
    public readonly string $url;
    private readonly string $log;
    /** @var resource */
    private $process;

    public function __construct()
    {
        $this->log = tempnam(sys_get_temp_dir(), 'fake-clikgate-');
        $port = self::freePort();
        $this->url = "http://127.0.0.1:{$port}";
        $command = [\PHP_BINARY, '-S', "127.0.0.1:{$port}", __DIR__ . '/fake-clikgate-router.php'];
        $env = ['FAKE_CLIKGATE_LOG' => $this->log] + getenv();
        $this->process = proc_open($command, [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, null, $env);
        self::waitUntilListening($port);
    }

    public function stop(): void
    {
        proc_terminate($this->process);
        proc_close($this->process);
        @unlink($this->log);
    }

    /** @return list<array{method: string, path: string, authorization: ?string, body: array<string, mixed>}> */
    public function requests(): array
    {
        $state = json_decode((string) file_get_contents($this->log), true);

        return \is_array($state) ? $state['requests'] : [];
    }

    /** @return list<array<string, mixed>> the bodies sent to one path */
    public function bodiesSentTo(string $path): array
    {
        return array_values(array_map(
            static fn(array $r): array => $r['body'],
            array_filter($this->requests(), static fn(array $r): bool => $r['path'] === $path),
        ));
    }

    /**
     * A `referral.qualified` or `referral.disqualified` webhook event as Clikgate sends it: the envelope, and the
     * referral in `data.object`.
     *
     * @return array<string, mixed>
     */
    public static function referralEvent(string $eventId, string $type, string $referralId, string $programId, string $referrerUserId): array
    {
        $qualified = 'referral.qualified' === $type;
        $steps = [['index' => 0, 'identify' => true, 'completed_at' => '2026-11-02T10:00:00Z', 'source_id' => 'identify:user_friend']];
        if ($qualified) {
            $steps[] = ['index' => 1, 'goal' => 'order_paid', 'completed_at' => '2026-11-03T09:59:00Z', 'source_id' => 'goal:cnv_01JCK8Z9V7Q4M2N6P8R0S2T4GE'];
        }
        $referral = [
            'id' => $referralId,
            'object' => 'referral',
            'program_id' => $programId,
            'referrer_id' => 'rfr_01JCK8Z9V7Q4M2N6P8R0S2T4RR',
            'status' => $qualified ? 'qualified' : 'disqualified',
            'source' => 'link',
            'match_type' => 'deterministic',
            'current_step' => \count($steps),
            'steps_completed' => $steps,
            'step_deadline_at' => null,
            'hold_until' => null,
            'qualified_at' => $qualified ? '2026-11-03T10:00:00Z' : null,
            'disqualified_at' => $qualified ? null : '2026-11-03T10:00:00Z',
            'rejected_at' => null,
            'reason' => $qualified ? null : 'step_timeout',
            'reason_detail' => null,
            'reason_message' => null,
            'fraud_flags' => [],
            'referee_uninstalled_after_qualification' => false,
            'program' => ['id' => $programId, 'name' => 'Invite friends'],
            'referrer' => ['id' => 'rfr_01JCK8Z9V7Q4M2N6P8R0S2T4RR', 'customer_user_id' => $referrerUserId, 'code' => 'TANGO1'],
            'referee' => ['install_id' => 'ins_01JCK8Z9V7Q4M2N6P8R0S2T4IN', 'installation_id' => '6a1f0c2e-0000-4000-8000-000000000002', 'customer_user_id' => 'user_friend'],
            'link' => ['id' => 'lnk_01JCK8Z9V7Q4M2N6P8R0S2T4AA'],
            'click_id' => 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6',
            'created_at' => '2026-11-02T09:45:00Z',
            'updated_at' => '2026-11-03T10:00:00Z',
            'livemode' => false,
        ];
        if ($qualified) {
            $referral['reward_snapshot'] = ['referrer' => ['amount_minor' => 100000, 'currency' => 'NGN'], 'note' => 'Paid by the app'];
        }

        return [
            'id' => $eventId,
            'object' => 'event',
            'type' => $type,
            'api_version' => '2026-10-01',
            'created_at' => '2026-11-03T10:00:00Z',
            'organization_id' => 'org_01JCK8Z9V7Q4M2N6P8R0S2T4OR',
            'livemode' => false,
            'data' => ['previous_attributes' => null, 'object' => $referral],
        ];
    }

    private static function freePort(): int
    {
        $socket = stream_socket_server('tcp://127.0.0.1:0');
        $port = (int) substr((string) stream_socket_get_name($socket, false), strrpos((string) stream_socket_get_name($socket, false), ':') + 1);
        fclose($socket);

        return $port;
    }

    private static function waitUntilListening(int $port): void
    {
        for ($i = 0; $i < 100; ++$i) {
            $connection = @fsockopen('127.0.0.1', $port);
            if (false !== $connection) {
                fclose($connection);

                return;
            }
            usleep(50_000);
        }
        throw new \RuntimeException('The fake Clikgate API did not start');
    }
}
