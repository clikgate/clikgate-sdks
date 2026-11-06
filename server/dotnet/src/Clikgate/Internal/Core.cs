using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace Clikgate.Internal;

/// <summary>
/// State shared by the resources of one client: logging, <c>OnError</c>, redaction, and the server SDK config
/// (<c>GET /v1/server-sdk/config</c>: single attempt, 10-minute cache, fail closed, 60 s negative cache).
/// </summary>
internal sealed class Core(Requester requester, IClikgateLogger logger, PrivateMode privateMode, Action<ClikgateException, ErrorContext>? onError)
{
    private const long ConfigTtlMs = 600_000;
    private const long ConfigRetryMs = 60_000;
    private readonly ConcurrentDictionary<string, bool> _warned = new();
    private readonly SemaphoreSlim _configLock = new(1, 1);
    private volatile ServerSdkConfig? _config;
    private long _fetchedAt;
    private long? _failedAt;
    private int _versionWarned;

    public Requester Requester { get; } = requester;

    public PrivateMode PrivateMode { get; } = privateMode;

    public void Warn(string code, string message, string? onceKey = null)
    {
        if (onceKey is not null && !_warned.TryAdd(code + ":" + onceKey, true))
        {
            return;
        }
        try
        {
            logger.Log(ClikgateLogLevel.Warning, code, message);
        }
        catch (Exception)
        {
            // a broken logger must not break the caller
        }
    }

    public ServerSdkConfig? PeekConfig() => _config;

    private bool Cached(out ServerSdkConfig? value)
    {
        var now = Requester.Clock.NowMilliseconds();
        var c = _config;
        if (c is not null && now - Interlocked.Read(ref _fetchedAt) < ConfigTtlMs)
        {
            value = c;
            return true;
        }
        var f = _failedAt;
        value = null;
        return f is not null && now - f.Value < ConfigRetryMs;
    }

    public async Task<ServerSdkConfig?> ConfigAsync(CancellationToken ct)
    {
        if (Cached(out var hit))
        {
            return hit;
        }
        await _configLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (Cached(out hit))
            {
                return hit;
            }
            try
            {
                var req = new ApiRequest("GET", "/v1/server-sdk/config") { MaxRetries = 0, Timeout = Requester.Timeout < TimeSpan.FromSeconds(5) ? Requester.Timeout : TimeSpan.FromSeconds(5) };
                var (_, data, _) = await Requester.RequestAsync(req, ct).ConfigureAwait(false);
                if (data is not JsonObject o || Json.Bool(o["private_mode"]) is null)
                {
                    throw new InvalidOperationException("unexpected config body");
                }
                var cfg = new ServerSdkConfig(o);
                _config = cfg;
                Interlocked.Exchange(ref _fetchedAt, Requester.Clock.NowMilliseconds());
                _failedAt = null;
                var minimum = cfg.MinimumVersion("dotnet");
                if (minimum is not null && SemverLess(SdkVersion.Value, minimum) && Interlocked.Exchange(ref _versionWarned, 1) == 0)
                {
                    Warn("sdk_below_minimum_version", "Clikgate (.NET) " + SdkVersion.Value + " is below the minimum version " + minimum + " for your organisation. Please upgrade.");
                }
                return cfg;
            }
            catch (Exception e) when (e is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                _config = null;
                _failedAt = Requester.Clock.NowMilliseconds();
                Warn("config_unavailable", "Could not load the server SDK config (" + (e is ClikgateException c ? c.Code : "error") + "); the private-mode guard stays on until it loads.");
                return null;
            }
        }
        finally
        {
            _configLock.Release();
        }
    }

    public async Task<(bool Guard, ServerSdkConfig? Config)> GuardStateAsync(CancellationToken ct)
    {
        if (PrivateMode == PrivateMode.On)
        {
            return (true, null);
        }
        if (PrivateMode == PrivateMode.Off)
        {
            return (false, null);
        }
        var c = await ConfigAsync(ct).ConfigureAwait(false);
        return (c is null || c.PrivateMode, c);
    }

    public bool MayBePrivate() => PrivateMode switch
    {
        PrivateMode.On => true,
        PrivateMode.Off => false,
        _ => _config is null || _config.PrivateMode,
    };

    public string ShownReference(string? reference) => MayBePrivate() ? Guard.Redacted : reference ?? string.Empty;

    public void Report(ClikgateException error, ErrorContext context)
    {
        try
        {
            var who = string.Join(", ", context.Events.Select(e => e.Goal + ":" + e.Reference));
            logger.Log(
                ClikgateLogLevel.Error,
                error.Code,
                "Clikgate " + context.Operation + " failed (" + Errors.Canonical(error) + " " + error.Code + (error.RequestId is null ? string.Empty : ", request " + error.RequestId) + ") for "
                    + (who.Length == 0 ? "no events" : who) + (context.Dropped ? "; dropped" : string.Empty) + ".");
        }
        catch (Exception)
        {
            // a broken logger must not break the caller
        }
        if (onError is null)
        {
            return;
        }
        try
        {
            onError(error, context);
        }
        catch (Exception e)
        {
            try
            {
                logger.Log(ClikgateLogLevel.Error, "on_error_failed", "OnError threw " + e.GetType().Name + ".");
            }
            catch (Exception)
            {
                // ignore
            }
        }
    }

    internal static bool SemverLess(string a, string b)
    {
        static int[] Parse(string v)
        {
            var core = v.Split('-', '+')[0].Split('.');
            var o = new int[3];
            for (var i = 0; i < 3 && i < core.Length; i++)
            {
                var digits = new string(core[i].TakeWhile(char.IsDigit).ToArray());
                o[i] = digits.Length > 0 && int.TryParse(digits, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var n) ? n : 0;
            }
            return o;
        }
        var x = Parse(a);
        var y = Parse(b);
        for (var i = 0; i < 3; i++)
        {
            if (x[i] != y[i])
            {
                return x[i] < y[i];
            }
        }
        return false;
    }

    public static IReadOnlyList<GoalRef> One(string goal, string reference) => [new GoalRef(goal, reference)];
}
