using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace Clikgate.Internal;

/// <summary>A request as the resources (and the generated layer) describe it.</summary>
internal sealed class ApiRequest(string method, string path, IEnumerable<KeyValuePair<string, object?>>? query = null)
{
    public string Method { get; } = method;

    public string Path { get; } = path;

    public IEnumerable<KeyValuePair<string, object?>>? Query { get; } = query;

    public bool HasBody { get; private set; }

    public object? Body { get; private set; }

    public string? IdempotencyKey { get; set; }

    public TimeSpan? Timeout { get; set; }

    public int? MaxRetries { get; set; }

    public ApiRequest WithBody(object? body)
    {
        HasBody = true;
        Body = body;
        return this;
    }

    public ApiRequest With(RequestOptions? options)
    {
        if (options is not null)
        {
            IdempotencyKey = options.IdempotencyKey ?? IdempotencyKey;
            Timeout = options.Timeout ?? Timeout;
            MaxRetries = options.MaxRetries ?? MaxRetries;
        }
        return this;
    }
}

/// <summary>The raw 2xx answer.</summary>
internal sealed class RawResponse(int status, IReadOnlyDictionary<string, string> headers, byte[] body)
{
    public int Status { get; } = status;

    public IReadOnlyDictionary<string, string> Headers { get; } = headers;

    public byte[] Body { get; } = body;
}

/// <summary>
/// The one HTTP pipeline every call (hand-written and generated) goes through: headers, retries with full-jitter
/// backoff, <c>Retry-After</c>, idempotency keys and typed errors (SPEC sections 4, 6, 7). Thread-safe.
/// </summary>
internal sealed class Requester(string apiKey, string baseUrl, TimeSpan timeout, int maxRetries, string userAgent, HttpClient http, IClikgateClock clock, Func<double> random)
{
    private const long BackoffBaseMs = 500;
    private const long BackoffCapMs = 20_000;
    private const long MaxRetryAfterMs = 60_000;
    private static readonly HttpMethod Patch = new("PATCH");
    private static readonly int[] Retryable = [429, 500, 502, 503, 504];
    private readonly object _randomLock = new();

    public IClikgateClock Clock { get; } = clock;

    public TimeSpan Timeout { get; } = timeout;

    public long BackoffMs(int n)
    {
        double r;
        lock (_randomLock)
        {
            r = random();
        }
        return (long)Math.Floor(r * Math.Min(BackoffCapMs, BackoffBaseMs * (1L << Math.Min(n, 30))));
    }

    public async Task<(int Status, JsonNode? Data, IReadOnlyDictionary<string, string> Headers)> RequestAsync(ApiRequest req, CancellationToken ct)
    {
        var res = await SendAsync(req, ct).ConfigureAwait(false);
        try
        {
            return (res.Status, Json.Parse(res.Body), res.Headers);
        }
        catch (System.Text.Json.JsonException e)
        {
            throw new ClikgateException("The API answered with a body that isn't JSON.", "invalid_response", res.Status, res.Headers.TryGetValue("x-request-id", out var r) ? r : null, inner: e);
        }
    }

    public async Task<RawResponse> SendAsync(ApiRequest req, CancellationToken ct)
    {
        var url = baseUrl + req.Path + QueryString(req.Query);
        byte[]? body = req.HasBody ? Json.Write(req.Body) : null;
        string? key = req.Method is "POST" or "PATCH" ? req.IdempotencyKey ?? Guid.NewGuid().ToString() : null;
        var retries = req.MaxRetries ?? maxRetries;
        var attemptTimeout = req.Timeout ?? Timeout;
        for (var n = 0; ; n++)
        {
            ct.ThrowIfCancellationRequested();
            RawResponse res;
            try
            {
                res = await AttemptAsync(req.Method, url, body, key, attemptTimeout, ct).ConfigureAwait(false);
            }
            catch (ClikgateException e) when (e is ClikgateNetworkException or ClikgateTimeoutException)
            {
                if (n >= retries)
                {
                    throw;
                }
                await Clock.DelayAsync(TimeSpan.FromMilliseconds(BackoffMs(n)), ct).ConfigureAwait(false);
                continue;
            }
            if (res.Status is >= 200 and < 300)
            {
                return res;
            }
            var error = Errors.FromResponse(res.Status, res.Headers, res.Body, Clock.NowMilliseconds());
            if (Array.IndexOf(Retryable, res.Status) < 0)
            {
                throw error;
            }
            var delay = BackoffMs(n);
            if (res.Status is 429 or 503)
            {
                var ra = Errors.RetryAfterMs(res.Headers, Clock.NowMilliseconds());
                if (ra is not null)
                {
                    if (ra > MaxRetryAfterMs)
                    {
                        throw error;
                    }
                    delay = ra.Value;
                }
            }
            if (n >= retries)
            {
                throw error;
            }
            await Clock.DelayAsync(TimeSpan.FromMilliseconds(delay), ct).ConfigureAwait(false);
        }
    }

    private async Task<RawResponse> AttemptAsync(string method, string url, byte[]? body, string? idempotencyKey, TimeSpan attemptTimeout, CancellationToken ct)
    {
        using var message = new HttpRequestMessage(method == "PATCH" ? Patch : new HttpMethod(method), url);
        message.Headers.TryAddWithoutValidation("Authorization", "Bearer " + apiKey);
        message.Headers.TryAddWithoutValidation("User-Agent", userAgent);
        message.Headers.TryAddWithoutValidation("Accept", "application/json");
        if (idempotencyKey is not null)
        {
            message.Headers.TryAddWithoutValidation("Idempotency-Key", idempotencyKey);
        }
        if (body is not null)
        {
            message.Content = new ByteArrayContent(body);
            message.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        }
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(attemptTimeout);
        try
        {
            using var response = await http.SendAsync(message, HttpCompletionOption.ResponseContentRead, cts.Token).ConfigureAwait(false);
#if NETSTANDARD2_0
            var bytes = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
#else
            var bytes = await response.Content.ReadAsByteArrayAsync(cts.Token).ConfigureAwait(false);
#endif
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var h in response.Headers.Concat(response.Content.Headers))
            {
                var name = h.Key.ToLowerInvariant();
                var value = string.Join(", ", h.Value);
                headers[name] = headers.TryGetValue(name, out var existing) ? existing + ", " + value : value;
            }
            return new RawResponse((int)response.StatusCode, headers, bytes);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new ClikgateTimeoutException("The request timed out after " + ((long)attemptTimeout.TotalMilliseconds).ToString(CultureInfo.InvariantCulture) + " ms.");
        }
        catch (HttpRequestException e)
        {
            throw new ClikgateNetworkException("Could not reach the Clikgate API (" + e.GetType().Name + ").", e);
        }
        catch (System.IO.IOException e)
        {
            throw new ClikgateNetworkException("Could not reach the Clikgate API (" + e.GetType().Name + ").", e);
        }
    }

    public static bool IsRetryable(Exception e) => e is ClikgateNetworkException or ClikgateTimeoutException or RateLimitException
        || (e is ServerException s && s.HttpStatus is int st && Array.IndexOf(Retryable, st) >= 0);

    public static string EncodePathSegment(string s) => Uri.EscapeDataString(s);

    public static string RequireId(object? value, string name)
    {
        if (value is int or long)
        {
            return Convert.ToString(value, CultureInfo.InvariantCulture)!;
        }
        return value is string s && s.Length > 0 ? s : throw Errors.Local("invalid_argument", name + " must be a non-empty string.", name);
    }

    /// <summary>Fills <c>{name}</c> placeholders with encoded values (used by the generated layer).</summary>
    public static string Path(string template, params (string Name, object? Value)[] parameters)
    {
        var sb = new StringBuilder(template);
        foreach (var (name, value) in parameters)
        {
            sb.Replace("{" + name + "}", EncodePathSegment(RequireId(value, name)));
        }
        return sb.ToString();
    }

    public static string QueryString(IEnumerable<KeyValuePair<string, object?>>? query)
    {
        if (query is null)
        {
            return string.Empty;
        }
        var parts = new List<string>();
        foreach (var kv in query)
        {
            // A map (e.g. metadata { seller_id = sel_ada }) is sent as metadata[seller_id]=sel_ada (SPEC section 21).
            var map = kv.Value switch
            {
                JsonObject jo => jo.Select(p => new KeyValuePair<string, object?>(p.Key, p.Value)).ToList(),
                System.Collections.IDictionary d => d.Keys.Cast<object>().Select(k => new KeyValuePair<string, object?>(Convert.ToString(k, CultureInfo.InvariantCulture) ?? string.Empty, d[k])).ToList(),
                _ => null,
            };
            if (map is not null)
            {
                foreach (var sub in map)
                {
                    if (sub.Value is not null)
                    {
                        parts.Add(Uri.EscapeDataString(kv.Key + "[" + sub.Key + "]") + "=" + Uri.EscapeDataString(Scalar(sub.Value)));
                    }
                }
                continue;
            }
            var items = kv.Value is System.Collections.IEnumerable e && kv.Value is not string ? e.Cast<object?>() : [kv.Value];
            foreach (var item in items)
            {
                if (item is null)
                {
                    continue;
                }
                parts.Add(Uri.EscapeDataString(kv.Key) + "=" + Uri.EscapeDataString(Scalar(item)));
            }
        }
        return parts.Count == 0 ? string.Empty : "?" + string.Join("&", parts);
    }

    private static string Scalar(object v) => v switch
    {
        bool b => b ? "true" : "false",
        DateTimeOffset or DateTime => Dates.Format(v),
        JsonNode n => n is JsonValue jv && jv.TryGetValue(out string? s) ? s : n.ToJsonString(),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => v.ToString() ?? string.Empty,
    };

#if !NETSTANDARD2_0
    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<HttpRequestMessage, object> Connected = new();

    /// <summary>
    /// SocketsHttpHandler silently re-sends a request on a second connection when the first one closes before any
    /// response byte. That would be an attempt the SDK doesn't count (SPEC 6: at most 1 + max_retries), so a second
    /// connection for the same request message fails, and the SDK's own retry policy decides.
    /// </summary>
    private static async ValueTask<System.IO.Stream> ConnectOnceAsync(SocketsHttpConnectionContext context, CancellationToken ct)
    {
        if (Connected.TryGetValue(context.InitialRequestMessage, out _))
        {
            throw new System.IO.IOException("The connection closed before the response.");
        }
        Connected.AddOrUpdate(context.InitialRequestMessage, true);
        var socket = new System.Net.Sockets.Socket(System.Net.Sockets.SocketType.Stream, System.Net.Sockets.ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(context.DnsEndPoint, ct).ConfigureAwait(false);
            return new System.Net.Sockets.NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }
#endif

    /// <summary>The built-in HttpClient: no redirects, the SDK's own timeouts, the system or an explicit proxy.</summary>
    public static HttpClient CreateDefault(string? proxy, bool noProxy)
    {
#if NETSTANDARD2_0
        var handler = new HttpClientHandler { AllowAutoRedirect = false };
#else
        var handler = new SocketsHttpHandler { AllowAutoRedirect = false, PooledConnectionLifetime = TimeSpan.FromMinutes(5), ConnectCallback = ConnectOnceAsync };
#endif
        if (noProxy)
        {
            handler.UseProxy = false;
        }
        else if (proxy is not null)
        {
            var uri = new Uri(proxy);
            var webProxy = new WebProxy(new Uri(uri.GetLeftPart(UriPartial.Authority)));
            if (!string.IsNullOrEmpty(uri.UserInfo))
            {
                var parts = uri.UserInfo.Split([':'], 2);
                webProxy.Credentials = new NetworkCredential(Uri.UnescapeDataString(parts[0]), parts.Length > 1 ? Uri.UnescapeDataString(parts[1]) : string.Empty);
            }
            handler.Proxy = webProxy;
            handler.UseProxy = true;
        }
        return new HttpClient(handler, disposeHandler: true) { Timeout = System.Threading.Timeout.InfiniteTimeSpan };
    }
}
