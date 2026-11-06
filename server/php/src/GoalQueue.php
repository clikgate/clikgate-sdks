<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Exception\ClikgateException;
use Clikgate\Exception\ErrorMapper;
use Clikgate\Http\ApiRequest;
use Clikgate\Http\Requester;

/**
 * @internal The `background` and `after_response` queue (SPEC 9.3). PHP has no timers: a batch is sent when
 * the queue reaches `batchSize`, on `flush()`, and at shutdown (after `fastcgi_finish_request()` for
 * `after_response`). One batch at a time, in queue order.
 */
final class GoalQueue
{
    private const MAX_FAILED_ROUNDS = 3;

    /** @var list<array{wire: array<string, mixed>, rounds: int}> */
    private array $items = [];
    private bool $sending = false;

    public function __construct(private readonly Core $core, private readonly int $batchSize, private readonly int $maxQueueSize) {}

    public function size(): int
    {
        return \count($this->items);
    }

    /**
     * @param array<string, mixed> $wire
     */
    public function enqueue(array $wire, bool $sendWhenFull): void
    {
        if (\count($this->items) >= $this->maxQueueSize) {
            $dropped = array_shift($this->items);
            if (null !== $dropped) {
                $this->core->warn('queue_full_dropped', "The Clikgate queue is full ({$this->maxQueueSize} events); the oldest event was dropped.");
                $this->core->report(ErrorMapper::local('queue_full', 'The background queue was full; this event was dropped.'), new ErrorContext('goal', [$this->shown($dropped['wire'])], true));
            }
        }
        $this->items[] = ['wire' => $wire, 'rounds' => 0];
        if ($sendWhenFull && !$this->sending && \count($this->items) >= $this->batchSize) {
            $this->sending = true;
            try {
                while (\count($this->items) >= $this->batchSize) {
                    $requeue = $this->sendBatch(array_splice($this->items, 0, $this->batchSize));
                    array_unshift($this->items, ...$requeue);
                    if ([] !== $requeue) {
                        break;
                    }
                }
            } finally {
                $this->sending = false;
            }
        }
    }

    /** Attempt every event queued now once; failed retryable ones go back to the front. Returns false past the deadline. */
    public function drain(float $timeout): bool
    {
        if ($this->sending) {
            return false;
        }
        $deadline = microtime(true) + $timeout;
        $this->sending = true;
        try {
            $remaining = \count($this->items);
            $requeue = [];
            while ($remaining > 0 && [] !== $this->items) {
                if (microtime(true) > $deadline) {
                    array_unshift($this->items, ...$requeue);

                    return false;
                }
                $batch = array_splice($this->items, 0, min($this->batchSize, $remaining));
                $remaining -= \count($batch);
                array_push($requeue, ...$this->sendBatch($batch));
            }
            array_unshift($this->items, ...$requeue);

            return true;
        } finally {
            $this->sending = false;
        }
    }

    /**
     * @param array<string, mixed> $wire
     *
     * @return array{goal: string, reference: string}
     */
    private function shown(array $wire): array
    {
        return ['goal' => \is_string($wire['goal'] ?? null) ? $wire['goal'] : '', 'reference' => $this->core->shownReference($wire['reference'] ?? null)];
    }

    /**
     * @param list<array{wire: array<string, mixed>, rounds: int}> $batch
     *
     * @return list<array{wire: array<string, mixed>, rounds: int}> the events to re-queue
     */
    private function sendBatch(array $batch): array
    {
        try {
            $state = $this->core->guardState();
        } catch (\Throwable) {
            $state = [true, null];
        }
        $sendable = [];
        foreach ($batch as $q) {
            try {
                Goals::checkBeforeSend($this->core, $state, $q['wire']);
                $sendable[] = $q;
            } catch (\Throwable $e) {
                $this->core->report(ErrorMapper::wrap($e), new ErrorContext('goal', [$this->shown($q['wire'])], true));
            }
        }
        if ([] === $sendable) {
            return [];
        }
        try {
            [, $data] = $this->core->requester->request((new ApiRequest('POST', '/v1/goals/events/batch'))->withBody(['events' => array_map(static fn(array $q): array => $q['wire'], $sendable)]));
        } catch (\Throwable $e) {
            $error = ErrorMapper::wrap($e);

            return $this->failed($error, $sendable);
        }
        foreach (\is_array($data) && \is_array($data['data'] ?? null) ? $data['data'] : [] as $item) {
            if (!\is_array($item) || true === ($item['ok'] ?? false)) {
                continue;
            }
            $index = $item['index'] ?? null;
            if (!\is_int($index) || !isset($sendable[$index])) {
                continue;
            }
            $status = \is_int($item['status'] ?? null) ? $item['status'] : 0;
            $this->core->report(ErrorMapper::fromBatchItem($status, $item['error'] ?? null), new ErrorContext('goal', [$this->shown($sendable[$index]['wire'])], true));
        }

        return [];
    }

    /**
     * @param list<array{wire: array<string, mixed>, rounds: int}> $sendable
     *
     * @return list<array{wire: array<string, mixed>, rounds: int}>
     */
    private function failed(ClikgateException $error, array $sendable): array
    {
        if (!Requester::isRetryable($error)) {
            $this->core->report($error, new ErrorContext('goals.batch', array_map(fn(array $q): array => $this->shown($q['wire']), $sendable), true));

            return [];
        }
        $keep = [];
        $drop = [];
        foreach ($sendable as $q) {
            ++$q['rounds'];
            if ($q['rounds'] >= self::MAX_FAILED_ROUNDS) {
                $drop[] = $q;
            } else {
                $keep[] = $q;
            }
        }
        if ([] !== $drop) {
            $this->core->report($error, new ErrorContext('goals.batch', array_map(fn(array $q): array => $this->shown($q['wire']), $drop), true));
        }

        return $keep;
    }
}
