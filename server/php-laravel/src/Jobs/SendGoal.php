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
 * failures fail the job at once. A goal the organisation hasn't set up (`unknown_goal`, while it accepts only set-up
 * goals) or an archived one (`goal_archived`) is final: the job ends without failing, so it is never retried or kept
 * as a failed job. With debug logging on, the SDK logs "Goal `{name}` isn't set up in Clikgate".
 */
final class SendGoal implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    /** Refusals that end the job: the goal isn't set up (strict goal names) or is archived. */
    private const FINAL_REFUSALS = ['unknown_goal', 'goal_archived'];

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
            if ($e instanceof InvalidRequestException && \in_array($e->getErrorCode(), self::FINAL_REFUSALS, true)) {
                return;
            }
            if ($e instanceof InvalidRequestException || !\Clikgate\Http\Requester::isRetryable($e)) {
                $this->fail($e);

                return;
            }
            throw $e;
        }
    }
}
