<?php

declare(strict_types=1);

namespace Clikgate\Laravel\Jobs;

use Clikgate\Clikgate as Client;
use Clikgate\Exception\ClikgateException;
use Clikgate\Exception\InvalidRequestException;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * Sends one goal from a queue worker (`CLIKGATE_QUEUE=redis`). Retryable failures are retried by the queue;
 * the API ignores a second event with the same goal and reference, so a retry never double counts. Validation and other 4xx
 * failures fail the job at once.
 */
final class SendGoal implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 5;

    /** @var list<int> */
    public array $backoff = [10, 30, 120, 600];

    /**
     * @param array<string, mixed> $options
     */
    public function __construct(public readonly string $key, public readonly array $options) {}

    public function handle(Client $client): void
    {
        try {
            $client->goals->send($this->key, $this->options);
        } catch (ClikgateException $e) {
            if ($e instanceof InvalidRequestException || !\Clikgate\Http\Requester::isRetryable($e)) {
                $this->fail($e);

                return;
            }
            throw $e;
        }
    }
}
