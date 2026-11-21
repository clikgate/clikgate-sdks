<?php

declare(strict_types=1);

namespace App;

/**
 * The sample's in-memory tables (users, sessions, webhook events, rewards). PHP keeps nothing between requests, so
 * they are read from one JSON file when a request starts and written back when it ends, with a lock so requests take
 * turns. In your app these are tables in your database, and this class goes away.
 */
final class State
{
    /** @var array<string, array<string, mixed>> */
    public array $tables = [];

    /** @var resource|null */
    private $handle;

    public function __construct(private readonly string $file) {}

    public function open(): void
    {
        $handle = fopen($this->file, 'c+');
        if (false === $handle || !flock($handle, \LOCK_EX)) {
            throw new \RuntimeException("Can't open the sample's state file {$this->file}");
        }
        $this->handle = $handle;
        $saved = json_decode((string) stream_get_contents($handle), true);
        $this->tables = (\is_array($saved) ? $saved : []) + ['users' => [], 'sessions' => [], 'webhook_events' => [], 'referral_rewards' => []];
    }

    public function close(): void
    {
        if (null === $this->handle) {
            return;
        }
        ftruncate($this->handle, 0);
        rewind($this->handle);
        fwrite($this->handle, json_encode($this->tables, \JSON_THROW_ON_ERROR));
        flock($this->handle, \LOCK_UN);
        fclose($this->handle);
        $this->handle = null;
    }
}
