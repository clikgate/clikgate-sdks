using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Clikgate.Internal;

namespace Clikgate;

/// <summary>The Clikgate client, as registered in dependency injection by <c>Clikgate.AspNetCore</c>.</summary>
public interface IClikgateClient : IAsyncDisposable, IDisposable
{
    /// <summary><c>live</c> or <c>test</c>, from the API key prefix.</summary>
    string Mode { get; }

    /// <summary>Goal events.</summary>
    Goals Goals { get; }

    /// <summary>Conversions (older API).</summary>
    Conversions Conversions { get; }

    /// <summary>Payments confirmed by your server after its own verification.</summary>
    Payments Payments { get; }

    /// <summary>Links.</summary>
    Links Links { get; }

    /// <summary>Clicks.</summary>
    Clicks Clicks { get; }

    /// <summary>Click-ID helpers using this client's parameter.</summary>
    ClickIds ClickIds { get; }

    /// <summary>Every API-key operation, generated from openapi.json ("advanced").</summary>
    Api.ApiClient Api { get; }

    /// <summary>Records a goal without waiting. Never throws.</summary>
    void Goal(string key, GoalOptions options);

    /// <summary>Sends a goal and waits (sync-mode semantics). Never throws.</summary>
    Task GoalAsync(string key, GoalOptions options, CancellationToken cancellationToken = default);

    /// <summary>The organisation's server SDK config, or null.</summary>
    Task<ServerSdkConfig?> ConfigAsync(CancellationToken cancellationToken = default);

    /// <summary>Sends everything queued. Never throws.</summary>
    Task<bool> FlushAsync(TimeSpan? timeout = null);

    /// <summary>Flushes and stops the background worker.</summary>
    Task<bool> CloseAsync(TimeSpan? timeout = null);
}

/// <summary>
/// The Clikgate client. Create one and reuse it: it is thread-safe.
/// </summary>
/// <example>
/// <code>
/// var clikgate = new ClikgateClient();                       // reads CLIKGATE_API_KEY
/// clikgate.Goal("account_opened", new GoalOptions { ClickId = clickId, Reference = "APP-55231", Value = 2_000_000m });
/// </code>
/// </example>
public sealed class ClikgateClient : IClikgateClient
{
    private static readonly Regex KeyPattern = new("^cg_(live|test)_[A-Za-z0-9_]+$", RegexOptions.CultureInvariant);
    private static readonly Regex ParamPattern = new("^[A-Za-z0-9_]{1,32}$", RegexOptions.CultureInvariant);
    private static readonly TimeSpan ShutdownFlush = TimeSpan.FromSeconds(5);
    private readonly Core _core;
    private readonly GoalSender _sender;
    private readonly SendMode _sendMode;
    private readonly IClikgateClock _clock;
    private readonly HttpClient? _ownHttp;
    private readonly EventHandler? _exitHandler;
    private int _closed;

    /// <summary>Creates a client from the environment (<c>CLIKGATE_API_KEY</c>, <c>CLIKGATE_BASE_URL</c>).</summary>
    /// <exception cref="ConfigurationException">No or an invalid API key.</exception>
    public ClikgateClient()
        : this(new ClikgateOptions())
    {
    }

    /// <summary>Creates a client.</summary>
    /// <exception cref="ConfigurationException">Invalid options.</exception>
    public ClikgateClient(ClikgateOptions options)
    {
        if (options is null)
        {
            throw new ArgumentNullException(nameof(options));
        }
        var apiKey = options.ApiKey ?? Environment.GetEnvironmentVariable("CLIKGATE_API_KEY");
        if (string.IsNullOrEmpty(apiKey))
        {
            throw new ConfigurationException("No API key: set ApiKey or CLIKGATE_API_KEY (cg_live_… or cg_test_…).", "missing_api_key", "ApiKey");
        }
        var m = KeyPattern.Match(apiKey);
        if (!m.Success)
        {
            throw new ConfigurationException("The API key is " + KeyType(apiKey!) + ". Server SDKs need a cg_live_… or cg_test_… API key from Developers → API keys.", "invalid_api_key", "ApiKey");
        }
        Mode = m.Groups[1].Value;
        var env = Environment.GetEnvironmentVariable("CLIKGATE_BASE_URL");
        var baseUrl = (options.BaseUrl ?? (string.IsNullOrEmpty(env) ? "https://api.clikgate.com" : env!)).TrimEnd('/');
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri))
        {
            throw Invalid("BaseUrl", "BaseUrl is not a URL.");
        }
        var local = uri.Host is "localhost" or "127.0.0.1" or "[::1]" or "::1";
        if (!(uri.Scheme == "https" || (uri.Scheme == "http" && local)))
        {
            throw Invalid("BaseUrl", "BaseUrl must use https:// (http:// only for localhost).");
        }
        if (options.Timeout <= TimeSpan.Zero || options.Timeout > TimeSpan.FromMinutes(10))
        {
            throw Invalid("Timeout", "Timeout must be more than 0 and at most 10 minutes.");
        }
        Range("MaxRetries", options.MaxRetries, 0, 10);
        Range("BatchSize", options.BatchSize, 1, 500);
        Range("MaxQueueSize", options.MaxQueueSize, 1, 1_000_000);
        if (options.FlushInterval <= TimeSpan.Zero || options.FlushInterval > TimeSpan.FromHours(1))
        {
            throw Invalid("FlushInterval", "FlushInterval must be more than 0 and at most 1 hour.");
        }
        var explicitParam = options.ClickIdParam;
        if (explicitParam is not null && !ParamPattern.IsMatch(explicitParam))
        {
            throw Invalid("ClickIdParam", "ClickIdParam must be 1-32 letters, digits or underscores.");
        }
        if (options.Proxy is not null && (!Uri.TryCreate(options.Proxy, UriKind.Absolute, out var p) || (p.Scheme != "http" && p.Scheme != "https")))
        {
            throw Invalid("Proxy", "Proxy must be an http:// or https:// URL.");
        }
        _clock = options.Clock ?? SystemClock.Instance;
        var http = options.HttpClient;
        if (http is null)
        {
            _ownHttp = Requester.CreateDefault(options.Proxy, options.NoProxy);
            http = _ownHttp;
        }
        var rng = new Random();
        var random = options.Random ?? (() => rng.NextDouble());
        var requester = new Requester(apiKey!, baseUrl, options.Timeout, options.MaxRetries, UserAgent.Current(), http, _clock, random);
        _core = new Core(requester, options.Logger ?? TraceLogger.Instance, options.PrivateMode, options.OnError);
        _sendMode = options.SendMode;
        _sender = new GoalSender(_core, options.BatchSize, options.MaxQueueSize, options.FlushInterval);
        Goals = new Goals(_core);
        Conversions = new Conversions(_core);
        Payments = new Payments(_core);
        Links = new Links(_core);
        Clicks = new Clicks(_core);
        var core = _core;
        ClickIds = new ClickIds(() => explicitParam ?? core.PeekConfig()?.ClickIdParam ?? "cgid");
        Api = new Api.ApiClient(requester);
        if (options.ShutdownHooks)
        {
            _exitHandler = (_, _) =>
            {
                if (_sender.Busy)
                {
                    FlushAsync(ShutdownFlush).GetAwaiter().GetResult();
                }
            };
            AppDomain.CurrentDomain.ProcessExit += _exitHandler;
        }
    }

    /// <inheritdoc/>
    public string Mode { get; }

    /// <inheritdoc/>
    public Goals Goals { get; }

    /// <inheritdoc/>
    public Conversions Conversions { get; }

    /// <inheritdoc/>
    public Payments Payments { get; }

    /// <inheritdoc/>
    public Links Links { get; }

    /// <inheritdoc/>
    public Clicks Clicks { get; }

    /// <inheritdoc/>
    public ClickIds ClickIds { get; }

    /// <inheritdoc/>
    public Api.ApiClient Api { get; }

    private IReadOnlyList<GoalRef> Shown(string? key, GoalOptions? options) => Core.One(key ?? string.Empty, _core.ShownReference(options?.Reference));

    /// <summary>
    /// Records a goal without waiting. <b>Never throws</b>: failures go to the logger and <see cref="ClikgateOptions.OnError"/>.
    /// In background mode the event is queued and sent in batches; in sync mode the request starts at once (<see cref="FlushAsync"/> waits for it).
    /// </summary>
    /// <example><code>clikgate.Goal("account_opened", new GoalOptions { ClickId = app.ClickId, Reference = "APP-55231", Value = 2_000_000m, Currency = "NGN" });</code></example>
    public void Goal(string key, GoalOptions options)
    {
        try
        {
            if (Volatile.Read(ref _closed) != 0)
            {
                _core.Report(Errors.Local("client_closed", "This Clikgate client is closed."), new ErrorContext("goal", Shown(key, options), true));
                return;
            }
            JsonObject wire;
            try
            {
                wire = Clikgate.Goals.Wire(key, options);
            }
            catch (Exception e)
            {
                _core.Report(Errors.Wrap(e), new ErrorContext("goal", Shown(key, options), true));
                return;
            }
            if (_sendMode == SendMode.Background)
            {
                _sender.Enqueue(wire);
                return;
            }
            _ = _sender.Post(() => SendOneAsync(key, options, wire, CancellationToken.None));
        }
        catch (Exception)
        {
            // Goal() never throws, whatever happens
        }
    }

    /// <summary>Sends one goal and waits for the answer, but <b>never throws</b> (failures go to <see cref="ClikgateOptions.OnError"/>). Use <c>Goals.SendAsync</c> to get the result.</summary>
    /// <example><code>await clikgate.GoalAsync("account_opened", new GoalOptions { Reference = "APP-55231" });</code></example>
    public async Task GoalAsync(string key, GoalOptions options, CancellationToken cancellationToken = default)
    {
        try
        {
            if (Volatile.Read(ref _closed) != 0)
            {
                _core.Report(Errors.Local("client_closed", "This Clikgate client is closed."), new ErrorContext("goal", Shown(key, options), true));
                return;
            }
            var wire = Clikgate.Goals.Wire(key, options);
            await SendOneAsync(key, options, wire, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception e)
        {
            _core.Report(Errors.Wrap(e), new ErrorContext("goal", Shown(key, options), true));
        }
    }

    private async Task SendOneAsync(string key, GoalOptions options, JsonObject wire, CancellationToken ct)
    {
        try
        {
            Clikgate.Goals.CheckBeforeSend(_core, await _core.GuardStateAsync(ct).ConfigureAwait(false), wire);
            await _core.Requester.RequestAsync(Clikgate.Goals.SendRequest(wire, null), ct).ConfigureAwait(false);
        }
        catch (Exception e)
        {
            _core.Report(Errors.Wrap(e), new ErrorContext("goal", Shown(key, options), true));
        }
    }

    /// <summary>
    /// Tells Clikgate who a person is (<c>POST /v1/people/identify</c>): a click, an app installation (<c>AppId</c> +
    /// <c>InstallationId</c>) or your <c>CustomerId</c>, at least one. With a click or installation, <c>CustomerId</c>
    /// links it to that customer. <c>Label</c> is what your team sees instead of the click ID (1-80 characters, <c>""</c>
    /// clears it; Growth and up). Always verified (your server), so it also satisfies a referral program's
    /// <c>require_identity_token</c>. In private mode <c>CustomerId</c> is refused locally and <c>Label</c> needs
    /// "Allow labels in private mode".
    /// </summary>
    /// <example><code>await clikgate.IdentifyUserAsync(new IdentifyUserParams { ClickId = clickId, CustomerId = "user_42", Label = "Ada (VIP)" });</code></example>
    public async Task<PersonIdentified> IdentifyUserAsync(IdentifyUserParams parameters, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var p = parameters ?? throw new ArgumentNullException(nameof(parameters));
        if ((p.AppId is null) != (p.InstallationId is null))
        {
            throw Errors.Local("invalid_request", "Send AppId and InstallationId together.", p.AppId is null ? "app_id" : "installation_id");
        }
        if (p.ClickId is null && p.InstallationId is null && p.CustomerId is null)
        {
            throw Errors.Local("invalid_request", "Send ClickId, AppId + InstallationId, or CustomerId.", "click_id");
        }
        var body = new JsonObject();
        if (p.ClickId is not null) body["click_id"] = p.ClickId;
        if (p.AppId is not null) body["app_id"] = p.AppId;
        if (p.InstallationId is not null) body["installation_id"] = p.InstallationId;
        if (p.CustomerId is not null) body["customer_id"] = p.CustomerId;
        if (p.Label is not null) body["label"] = p.Label;
        if ((await _core.GuardStateAsync(cancellationToken).ConfigureAwait(false)).Guard)
        {
            Guard.Check("identify", body);
        }
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("POST", "/v1/people/identify").WithBody(body).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return new PersonIdentified(data as JsonObject);
    }

    /// <summary>The organisation's server SDK config (private mode, click-ID parameter, goals), cached for 10 minutes; null when it can't be loaded.</summary>
    /// <example><code>var config = await clikgate.ConfigAsync(); if (config?.PrivateMode == true) Console.WriteLine("private mode is on");</code></example>
    public Task<ServerSdkConfig?> ConfigAsync(CancellationToken cancellationToken = default) => _core.ConfigAsync(cancellationToken);

    /// <summary>Verifies a webhook with this client's clock (see <see cref="Webhooks"/>).</summary>
    public WebhookEvent VerifyWebhook(byte[] rawBody, string? signatureHeader, string secret) => Webhooks.Verify(rawBody, signatureHeader, secret, Webhooks.DefaultTolerance, _clock.NowMilliseconds() / 1000);

    /// <summary>Sends everything queued (and waits for sends in flight). True when done within the timeout (default 10 s). Never throws.</summary>
    /// <example><code>await clikgate.FlushAsync();   // at the end of an Azure Function or a batch job</code></example>
    public async Task<bool> FlushAsync(TimeSpan? timeout = null)
    {
        try
        {
            return await _sender.FlushAsync(timeout ?? TimeSpan.FromSeconds(10)).ConfigureAwait(false);
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>Flushes, then stops the worker and releases connections. Later <c>Goal()</c> calls go to <c>OnError</c> (<c>client_closed</c>).</summary>
    public async Task<bool> CloseAsync(TimeSpan? timeout = null)
    {
        if (Interlocked.Exchange(ref _closed, 1) != 0)
        {
            return await FlushAsync(timeout).ConfigureAwait(false);
        }
        if (_exitHandler is not null)
        {
            AppDomain.CurrentDomain.ProcessExit -= _exitHandler;
        }
        var done = await FlushAsync(timeout).ConfigureAwait(false);
        _sender.Stop();
        _ownHttp?.Dispose();
        return done;
    }

    /// <inheritdoc/>
    public async ValueTask DisposeAsync() => await CloseAsync().ConfigureAwait(false);

    /// <inheritdoc/>
    public void Dispose() => CloseAsync().GetAwaiter().GetResult();

    private static void Range(string name, int v, int lo, int hi)
    {
        if (v < lo || v > hi)
        {
            throw Invalid(name, name + " must be a number from " + lo + " to " + hi + ".");
        }
    }

    private static ConfigurationException Invalid(string param, string message) => new(message, "invalid_option", param);

    private static string KeyType(string k) =>
        k.StartsWith("cg_sdk_", StringComparison.Ordinal) ? "a mobile SDK key (cg_sdk_…)"
        : k.StartsWith("cg_site_", StringComparison.Ordinal) ? "a web script site key (cg_site_…)"
        : k.StartsWith("cg_cli_", StringComparison.Ordinal) ? "a setup command token (cg_cli_…)"
        : "not a Clikgate server API key";
}
