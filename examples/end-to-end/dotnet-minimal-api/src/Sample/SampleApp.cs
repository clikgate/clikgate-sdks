using Clikgate;

namespace Sample;

/// <summary>Builds the app and everything it uses, in one place.</summary>
public static class SampleApp
{
    /// <param name="settings">Extra settings over the environment (the test points the app at a fake API).</param>
    public static WebApplication Create(string[] args, IDictionary<string, string?>? settings = null)
    {
        var builder = WebApplication.CreateBuilder(args);
        if (settings is not null) builder.Configuration.AddInMemoryCollection(settings);
        var config = SampleConfig.From(builder.Configuration);

        // One client for the whole process (a singleton). The host flushes queued goals when it stops.
        builder.Services.AddClikgate(o =>
        {
            o.ApiKey = config.ApiKey;
            o.BaseUrl = config.BaseUrl;
            o.IdentitySecret = config.IdentitySecret;
        });
        builder.Services.AddSingleton(config);
        builder.Services.AddSingleton<UserStore>();
        builder.Services.AddSingleton<ClikgateIdentity>();
        builder.Services.AddSingleton<ProcessedEvents>();
        builder.Services.AddSingleton<RewardStore>();
        builder.Services.AddHttpClient<ReferralCodes>();

        var app = builder.Build();
        app.MapAuthEndpoints();
        app.MapPaymentEndpoints();
        app.MapReferralEndpoints();
        app.MapWebhookEndpoints();
        return app;
    }
}
