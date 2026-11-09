using System;
using System.Diagnostics;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace Clikgate;

/// <summary>How <c>Goal()</c> sends (SPEC 9.3).</summary>
public enum SendMode
{
    /// <summary>The default: queue and send in batches from a background worker.</summary>
    Background,

    /// <summary>Send each goal at once (still never throws; failures go to <see cref="ClikgateOptions.OnError"/>).</summary>
    Sync,
}

/// <summary>The private-mode guard (SPEC 12).</summary>
public enum PrivateMode
{
    /// <summary>The default: follow the organisation's setting from <c>GET /v1/server-sdk/config</c> (fail closed).</summary>
    Auto,

    /// <summary>Always guard.</summary>
    On,

    /// <summary>Never guard locally (the server still enforces).</summary>
    Off,
}

/// <summary>Log levels the SDK uses.</summary>
public enum ClikgateLogLevel
{
    /// <summary>Debug.</summary>
    Debug,

    /// <summary>A warning with a stable code (<c>inexact_number</c>, <c>unknown_goal</c>, <c>config_unavailable</c>, …).</summary>
    Warning,

    /// <summary>A failure that couldn't be thrown (background sends, <c>Goal()</c>).</summary>
    Error,
}

/// <summary>
/// Where the SDK logs (SPEC section 15). Messages never contain API keys, secrets, bodies, values or (in private mode)
/// references. <c>Clikgate.AspNetCore</c> adapts <c>ILogger</c>; the default writes warnings and errors to
/// <see cref="Trace"/>.
/// </summary>
public interface IClikgateLogger
{
    /// <summary>Writes one line with a stable code.</summary>
    void Log(ClikgateLogLevel level, string code, string message);
}

/// <summary>Clock and delay, replaceable for tests (SPEC section 18).</summary>
public interface IClikgateClock
{
    /// <summary>Milliseconds since the Unix epoch.</summary>
    long NowMilliseconds();

    /// <summary>Waits (the retry delay).</summary>
    Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken);
}

/// <summary>What <see cref="ClikgateOptions.OnError"/> receives next to the exception (SPEC 9.5). Never values, metadata or consent.</summary>
public sealed class ErrorContext
{
    internal ErrorContext(string operation, System.Collections.Generic.IReadOnlyList<GoalRef> events, bool dropped)
    {
        Operation = operation;
        Events = events;
        Dropped = dropped;
    }

    /// <summary><c>goal</c>, <c>goals.batch</c> or <c>config</c>.</summary>
    public string Operation { get; }

    /// <summary>The affected events; references are <c>[redacted]</c> while private mode is on.</summary>
    public System.Collections.Generic.IReadOnlyList<GoalRef> Events { get; }

    /// <summary>True when the events won't be retried.</summary>
    public bool Dropped { get; }
}

/// <summary>A goal key and (possibly redacted) reference.</summary>
public sealed record GoalRef(string Goal, string Reference);

/// <summary>Per-call options accepted by every API method.</summary>
public sealed class RequestOptions
{
    /// <summary>Override the <c>Idempotency-Key</c> (POST and PATCH only).</summary>
    public string? IdempotencyKey { get; init; }

    /// <summary>Override the client's per-attempt timeout.</summary>
    public TimeSpan? Timeout { get; init; }

    /// <summary>Override the client's <c>MaxRetries</c>.</summary>
    public int? MaxRetries { get; init; }
}

/// <summary>Client options (SPEC section 3). Every option is optional.</summary>
/// <example><code>var clikgate = new ClikgateClient(new ClikgateOptions { ApiKey = key, Timeout = TimeSpan.FromSeconds(5) });</code></example>
public sealed class ClikgateOptions
{
    /// <summary><c>cg_live_…</c> or <c>cg_test_…</c>. Default: the <c>CLIKGATE_API_KEY</c> environment variable.</summary>
    public string? ApiKey { get; set; }

    /// <summary>Default <c>CLIKGATE_BASE_URL</c>, else <c>https://api.clikgate.com</c>.</summary>
    public string? BaseUrl { get; set; }

    /// <summary>Per-attempt timeout covering connect, send and receive (default 10 s).</summary>
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(10);

    /// <summary>Retries for network errors, timeouts and HTTP 429, 500, 502, 503 and 504 (default 3, at most 10).</summary>
    public int MaxRetries { get; set; } = 3;

    /// <summary><see cref="Clikgate.SendMode.Background"/> (default) or <see cref="Clikgate.SendMode.Sync"/>.</summary>
    public SendMode SendMode { get; set; } = SendMode.Background;

    /// <summary><see cref="Clikgate.PrivateMode.Auto"/> (default), <see cref="Clikgate.PrivateMode.On"/> or <see cref="Clikgate.PrivateMode.Off"/>.</summary>
    public PrivateMode PrivateMode { get; set; } = PrivateMode.Auto;

    /// <summary>The click-ID query parameter (default: from config, else <c>cgid</c>).</summary>
    public string? ClickIdParam { get; set; }

    /// <summary>Where to log (default: warnings and errors to <see cref="Trace"/>).</summary>
    public IClikgateLogger? Logger { get; set; }

    /// <summary>Called for failures that can't be thrown (background sends, every <c>Goal()</c>).</summary>
    public Action<ClikgateException, ErrorContext>? OnError { get; set; }

    /// <summary>Your own <see cref="System.Net.Http.HttpClient"/> (from <c>IHttpClientFactory</c>, with mTLS or a proxy). It must not follow redirects.</summary>
    public HttpClient? HttpClient { get; set; }

    /// <summary>An <c>http(s)://user:pass@host:port</c> proxy. Default: the system proxy.</summary>
    public string? Proxy { get; set; }

    /// <summary>Ignore the system proxy.</summary>
    public bool NoProxy { get; set; }

    /// <summary>Background batch size, 1-500 (default 100).</summary>
    public int BatchSize { get; set; } = 100;

    /// <summary>Background flush interval (default 1 s).</summary>
    public TimeSpan FlushInterval { get; set; } = TimeSpan.FromSeconds(1);

    /// <summary>Background queue bound (default 10,000); when full, the oldest event is dropped.</summary>
    public int MaxQueueSize { get; set; } = 10_000;

    /// <summary>Flush on process exit (<c>AppDomain.ProcessExit</c>; default true). ASP.NET Core flushes in <c>IHostedService.StopAsync</c>.</summary>
    public bool ShutdownHooks { get; set; } = true;

    /// <summary>The identity secret for <c>CreateIdentityToken()</c>. Default: the <c>CLIKGATE_IDENTITY_SECRET</c> environment variable.</summary>
    public string? IdentitySecret { get; set; }

    /// <summary>Several apps' identity secrets, by app ID. Default: <c>CLIKGATE_IDENTITY_SECRETS</c> (a JSON object).</summary>
    public System.Collections.Generic.IDictionary<string, string>? IdentitySecrets { get; set; }

    /// <summary>Advanced (tests): replace the clock and delay.</summary>
    public IClikgateClock? Clock { get; set; }

    /// <summary>Advanced (tests): the random source for backoff jitter, in [0, 1).</summary>
    public Func<double>? Random { get; set; }
}

internal sealed class SystemClock : IClikgateClock
{
    public static readonly SystemClock Instance = new();

    public long NowMilliseconds() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    public Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken) => delay <= TimeSpan.Zero ? Task.CompletedTask : Task.Delay(delay, cancellationToken);
}

internal sealed class TraceLogger : IClikgateLogger
{
    public static readonly TraceLogger Instance = new();

    public void Log(ClikgateLogLevel level, string code, string message)
    {
        if (level == ClikgateLogLevel.Warning)
        {
            Trace.TraceWarning("[clikgate] {0} ({1})", message, code);
        }
        else if (level == ClikgateLogLevel.Error)
        {
            Trace.TraceError("[clikgate] {0} ({1})", message, code);
        }
    }
}
