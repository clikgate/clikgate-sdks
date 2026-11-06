using System;
using System.Threading;
using System.Threading.Tasks;
using Clikgate;
using Clikgate.AspNetCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Microsoft.Extensions.DependencyInjection;

/// <summary>Registers Clikgate in dependency injection.</summary>
public static class ClikgateServiceCollectionExtensions
{
    /// <summary>
    /// Registers one <see cref="IClikgateClient"/> (a singleton) configured from the <c>Clikgate</c> configuration section
    /// (<c>Clikgate:ApiKey</c>, <c>Clikgate:SendMode</c>, …; <c>CLIKGATE_API_KEY</c> still works), then <paramref name="configure"/>.
    /// Logs through <c>ILogger</c> (category <c>Clikgate</c>) and flushes queued goals when the host stops.
    /// </summary>
    /// <example>
    /// <code>
    /// builder.Services.AddClikgate();
    /// builder.Services.AddClikgate(o => o.PrivateMode = PrivateMode.On);
    /// </code>
    /// </example>
    public static IServiceCollection AddClikgate(this IServiceCollection services, Action<ClikgateOptions>? configure = null)
    {
        services.AddOptions<ClikgateOptions>().Configure<IConfiguration>((o, config) => Bind(config.GetSection("Clikgate"), o));
        if (configure is not null)
        {
            services.Configure(configure);
        }
        services.TryAddSingleton<IClikgateClient>(sp =>
        {
            var o = sp.GetRequiredService<IOptions<ClikgateOptions>>().Value;
            o.Logger ??= new ILoggerAdapter(sp.GetRequiredService<ILoggerFactory>().CreateLogger("Clikgate"));
            o.ShutdownHooks = false; // the host flushes in StopAsync
            return new ClikgateClient(o);
        });
        services.TryAddSingleton(sp => (ClikgateClient)sp.GetRequiredService<IClikgateClient>());
        services.AddHostedService<ClikgateFlushService>();
        return services;
    }

    /// <summary>Like <see cref="AddClikgate(IServiceCollection, Action{ClikgateOptions}?)"/>, reading another configuration section.</summary>
    public static IServiceCollection AddClikgate(this IServiceCollection services, IConfiguration section, Action<ClikgateOptions>? configure = null)
    {
        services.AddClikgate(configure);
        services.PostConfigure<ClikgateOptions>(o => Bind(section, o));
        return services;
    }

    /// <summary>Binds the scalar options by hand (no reflection binder, trimming-safe).</summary>
    internal static void Bind(IConfiguration c, ClikgateOptions o)
    {
        o.ApiKey = c["ApiKey"] ?? o.ApiKey;
        o.BaseUrl = c["BaseUrl"] ?? o.BaseUrl;
        if (TimeSpan.TryParse(c["Timeout"], System.Globalization.CultureInfo.InvariantCulture, out var t))
        {
            o.Timeout = t;
        }
        if (int.TryParse(c["MaxRetries"], out var r))
        {
            o.MaxRetries = r;
        }
        if (Enum.TryParse<SendMode>(c["SendMode"], true, out var sm))
        {
            o.SendMode = sm;
        }
        var pm = c["PrivateMode"];
        if (pm is not null)
        {
            o.PrivateMode = pm.ToLowerInvariant() switch
            {
                "true" or "on" => PrivateMode.On,
                "false" or "off" => PrivateMode.Off,
                _ => PrivateMode.Auto,
            };
        }
        o.ClickIdParam = c["ClickIdParam"] ?? o.ClickIdParam;
        o.Proxy = c["Proxy"] ?? o.Proxy;
        if (int.TryParse(c["BatchSize"], out var bs))
        {
            o.BatchSize = bs;
        }
        if (TimeSpan.TryParse(c["FlushInterval"], System.Globalization.CultureInfo.InvariantCulture, out var fi))
        {
            o.FlushInterval = fi;
        }
        if (int.TryParse(c["MaxQueueSize"], out var mq))
        {
            o.MaxQueueSize = mq;
        }
    }

    private sealed class ILoggerAdapter(ILogger logger) : IClikgateLogger
    {
        public void Log(ClikgateLogLevel level, string code, string message)
        {
            var l = level switch
            {
                ClikgateLogLevel.Error => LogLevel.Error,
                ClikgateLogLevel.Warning => LogLevel.Warning,
                _ => LogLevel.Debug,
            };
            if (logger.IsEnabled(l))
            {
#pragma warning disable CA2254 // the message is built by the SDK and contains no secrets
                logger.Log(l, new EventId(0, code), message);
#pragma warning restore CA2254
            }
        }
    }
}

/// <summary>Flushes queued goals when the host stops (SPEC 9.4).</summary>
internal sealed class ClikgateFlushService(IClikgateClient client) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public Task StopAsync(CancellationToken cancellationToken) => client.FlushAsync(TimeSpan.FromSeconds(5));
}
