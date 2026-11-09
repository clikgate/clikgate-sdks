using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace Clikgate.Internal;

/// <summary>
/// The background queue and sender (SPEC 9.3): one worker loop runs jobs in order (batches and sync-mode sends), so
/// at most one batch is in flight per client and requests leave in queue order. The worker is a pooled task, so it
/// never keeps the process alive.
/// </summary>
internal sealed class GoalSender : IDisposable
{
    private const int MaxFailedRounds = 3;
    private readonly Core _core;
    private readonly int _batchSize;
    private readonly int _maxQueueSize;
    private readonly TimeSpan _flushInterval;
    private readonly LinkedList<Queued> _items = new();
    private readonly Queue<Func<Task>> _jobs = new();
    private readonly object _lock = new();
    private readonly SemaphoreSlim _signal = new(0);
    private readonly CancellationTokenSource _stop = new();
    private int _pending;
    private bool _sizeJobPending;
    private Task? _worker;

    public GoalSender(Core core, int batchSize, int maxQueueSize, TimeSpan flushInterval)
    {
        _core = core;
        _batchSize = batchSize;
        _maxQueueSize = maxQueueSize;
        _flushInterval = flushInterval;
    }

    private sealed class Queued(JsonObject wire)
    {
        public JsonObject Wire { get; } = wire;

        public int Rounds { get; set; }
    }

    public int Size
    {
        get
        {
            lock (_lock)
            {
                return _items.Count;
            }
        }
    }

    public bool Busy => Size > 0 || Volatile.Read(ref _pending) > 0;

    private void EnsureWorker()
    {
        if (_worker is null || _worker.IsCompleted)
        {
            _worker = Task.Run(RunAsync);
        }
    }

    private async Task RunAsync()
    {
        while (!_stop.IsCancellationRequested)
        {
            bool signalled;
            try
            {
                signalled = await _signal.WaitAsync(Size > 0 ? _flushInterval : Timeout.InfiniteTimeSpan, _stop.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            if (!signalled)
            {
                await SafeAsync(DrainOnceAsync).ConfigureAwait(false);
                continue;
            }
            Func<Task>? job;
            lock (_lock)
            {
                job = _jobs.Count > 0 ? _jobs.Dequeue() : null;
            }
            if (job is not null)
            {
                await SafeAsync(job).ConfigureAwait(false);
                Interlocked.Decrement(ref _pending);
            }
        }
    }

    private static async Task SafeAsync(Func<Task> job)
    {
        try
        {
            await job().ConfigureAwait(false);
        }
        catch (Exception)
        {
            // reported inside
        }
    }

    /// <summary>Runs a job on the worker, in order. Completes when the job has run.</summary>
    public Task Post(Func<Task> job)
    {
        var done = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        Interlocked.Increment(ref _pending);
        lock (_lock)
        {
            _jobs.Enqueue(async () =>
            {
                try
                {
                    await job().ConfigureAwait(false);
                }
                finally
                {
                    done.TrySetResult(true);
                }
            });
            if (_stop.IsCancellationRequested)
            {
                // stopped: run inline
                var j = _jobs.Dequeue();
                Interlocked.Decrement(ref _pending);
                _ = SafeAsync(j);
                return done.Task;
            }
            EnsureWorker();
        }
        _signal.Release();
        return done.Task;
    }

    public void Enqueue(JsonObject wire)
    {
        Queued? dropped = null;
        int size;
        lock (_lock)
        {
            if (_items.Count >= _maxQueueSize)
            {
                dropped = _items.First!.Value;
                _items.RemoveFirst();
            }
            _items.AddLast(new Queued(wire));
            size = _items.Count;
        }
        if (dropped is not null)
        {
            _core.Warn("queue_full_dropped", "The Clikgate queue is full (" + _maxQueueSize + " events); the oldest event was dropped.");
            _core.Report(Errors.Local("queue_full", "The background queue was full; this event was dropped."), new ErrorContext("goal", [Shown(dropped.Wire)], true));
        }
        if (size >= _batchSize && !_sizeJobPending)
        {
            _sizeJobPending = true;
            _ = Post(SizeJobAsync);
        }
        else if (size == 1)
        {
            _ = Post(() => Task.CompletedTask); // wake the worker so its interval timer runs
        }
    }

    private async Task SizeJobAsync()
    {
        _sizeJobPending = false;
        while (Size >= _batchSize)
        {
            var requeue = await SendBatchAsync(Take(_batchSize)).ConfigureAwait(false);
            Requeue(requeue);
            if (requeue.Count > 0)
            {
                break;
            }
        }
    }

    private List<Queued> Take(int n)
    {
        lock (_lock)
        {
            var o = new List<Queued>();
            while (o.Count < n && _items.Count > 0)
            {
                o.Add(_items.First!.Value);
                _items.RemoveFirst();
            }
            return o;
        }
    }

    private void Requeue(List<Queued> batch)
    {
        lock (_lock)
        {
            for (var i = batch.Count - 1; i >= 0; i--)
            {
                _items.AddFirst(batch[i]);
            }
        }
    }

    public async Task DrainOnceAsync()
    {
        var remaining = Size;
        var requeue = new List<Queued>();
        while (remaining > 0 && Size > 0)
        {
            var batch = Take(Math.Min(_batchSize, remaining));
            remaining -= batch.Count;
            requeue.AddRange(await SendBatchAsync(batch).ConfigureAwait(false));
        }
        Requeue(requeue);
    }

    private GoalRef Shown(JsonObject wire) => new(Json.Str(wire["goal"]) ?? string.Empty, _core.ShownReference(Json.Str(wire["reference"])));

    private async Task<List<Queued>> SendBatchAsync(List<Queued> batch)
    {
        (bool Guard, ServerSdkConfig? Config) state;
        try
        {
            state = await _core.GuardStateAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception)
        {
            state = (true, null);
        }
        var sendable = new List<Queued>();
        foreach (var q in batch)
        {
            try
            {
                Clikgate.Goals.CheckBeforeSend(_core, state, q.Wire);
                sendable.Add(q);
            }
            catch (Exception e)
            {
                _core.Report(Errors.Wrap(e), new ErrorContext("goal", [Shown(q.Wire)], true));
            }
        }
        if (sendable.Count == 0)
        {
            return [];
        }
        var body = new JsonObject { ["events"] = new JsonArray(sendable.Select(q => q.Wire.DeepClone()).ToArray()) };
        JsonNode? data;
        try
        {
            (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("POST", "/v1/goals/events/batch").WithBody(body), CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception e)
        {
            return Failed(Errors.Wrap(e), sendable);
        }
        if (data is JsonObject o && o["data"] is JsonArray items)
        {
            foreach (var node in items)
            {
                if (node is not JsonObject item || Json.Bool(item["ok"]) == true)
                {
                    continue;
                }
                var index = Json.Int(item["index"]);
                if (index is null || index < 0 || index >= sendable.Count)
                {
                    continue;
                }
                _core.Report(Errors.FromBatchItem(Json.Int(item["status"]) ?? 0, item["error"]), new ErrorContext("goal", [Shown(sendable[index.Value].Wire)], true));
            }
        }
        _core.NoteRefusedItems(sendable.Select(q => q.Wire).ToList(), data);
        return [];
    }

    private List<Queued> Failed(ClikgateException error, List<Queued> sendable)
    {
        if (!Requester.IsRetryable(error))
        {
            foreach (var q in sendable)
            {
                _core.NoteRefusedGoal(Json.Str(q.Wire["goal"]), error.Code);
            }
            _core.Report(error, new ErrorContext("goals.batch", sendable.Select(q => Shown(q.Wire)).ToList(), true));
            return [];
        }
        var keep = new List<Queued>();
        var drop = new List<Queued>();
        foreach (var q in sendable)
        {
            q.Rounds++;
            (q.Rounds >= MaxFailedRounds ? drop : keep).Add(q);
        }
        if (drop.Count > 0)
        {
            _core.Report(error, new ErrorContext("goals.batch", drop.Select(q => Shown(q.Wire)).ToList(), true));
        }
        return keep;
    }

    /// <summary>Waits until everything queued or in flight now has been attempted. Never throws.</summary>
    public async Task<bool> FlushAsync(TimeSpan timeout)
    {
        var job = Post(DrainOnceAsync);
        var finished = await Task.WhenAny(job, Task.Delay(timeout)).ConfigureAwait(false);
        return finished == job;
    }

    public void Stop() => _stop.Cancel();

    public void Dispose() => _stop.Cancel();
}
