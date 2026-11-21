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
