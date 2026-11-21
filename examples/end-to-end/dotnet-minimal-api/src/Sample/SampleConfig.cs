namespace Sample;

/// <summary>Settings, read only from the environment (see .env.example).</summary>
/// <param name="BaseUrl">Only set for a local fake of the API (the tests use one); the default is the real API.</param>
/// <param name="IdentitySecret">Optional: without it, responses carry no identity token and the app uses the installation header.</param>
/// <param name="ReferralProgramId">One referral program ID in your configuration, never one per user.</param>
public sealed record SampleConfig(string ApiKey, string BaseUrl, string? IdentitySecret, string WebhookSecret, string ReferralProgramId)
{
    public static SampleConfig From(IConfiguration configuration) => new(
        ApiKey: Required(configuration, "CLIKGATE_API_KEY"),
        BaseUrl: Optional(configuration, "CLIKGATE_BASE_URL") ?? "https://api.clikgate.com",
        IdentitySecret: Optional(configuration, "CLIKGATE_IDENTITY_SECRET"),
        WebhookSecret: Required(configuration, "CLIKGATE_WEBHOOK_SECRET"),
        ReferralProgramId: Required(configuration, "CLIKGATE_REFERRAL_PROGRAM_ID"));

    private static string? Optional(IConfiguration configuration, string name) =>
        string.IsNullOrEmpty(configuration[name]) ? null : configuration[name];

    private static string Required(IConfiguration configuration, string name) =>
        Optional(configuration, name) ?? throw new InvalidOperationException($"{name} is not set (see .env.example)");
}
