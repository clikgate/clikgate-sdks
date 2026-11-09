using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Xunit;

namespace Clikgate.Tests;

/// <summary>Change 22 I.1 / R.27: identity tokens against the shared vectors made by the backend signer.</summary>
public class IdentityTokensTests
{
    private static readonly JsonElement Doc = Load();

    private static JsonElement Load()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "conformance", "vectors", "identity-token-vectors.json")))
        {
            dir = dir.Parent;
        }
        Assert.NotNull(dir);
        return JsonDocument.Parse(File.ReadAllText(Path.Combine(dir!.FullName, "conformance", "vectors", "identity-token-vectors.json"))).RootElement.Clone();
    }

    private static JsonElement Vector(string name) => Doc.GetProperty("vectors").EnumerateArray().First(v => v.GetProperty("name").GetString() == name);

    private static Func<string, string?> Env(Dictionary<string, string> values) => k => values.TryGetValue(k, out var v) ? v : null;

    private static string S(JsonElement v, string key) => v.GetProperty(key).GetString()!;

    [Fact]
    public void Matches_the_shared_vectors()
    {
        var vectors = Doc.GetProperty("vectors").EnumerateArray().ToList();
        Assert.True(vectors.Count >= 10);
        foreach (var v in vectors)
        {
            Assert.Equal(S(v, "token"), IdentityTokens.Create(S(v, "customer_id"), S(v, "secret"), v.GetProperty("issued_at").GetInt64()));
        }
    }

    [Fact]
    public void Secret_from_the_environment_and_the_per_app_map()
    {
        var a = Vector("ascii");
        var other = Vector("other_app_secret");
        var at = a.GetProperty("issued_at").GetInt64();
        var single = new Dictionary<string, string> { [IdentityTokens.SecretEnv] = S(a, "secret") };
        Assert.Equal(S(a, "token"), IdentityTokens.CreateWith(false, null, null, Env(single), "user_42", null, null, at));
        Assert.Equal(S(a, "token"), IdentityTokens.CreateWith(false, null, null, Env(single), "user_42", "app_unknown", null, at));
        var map = new Dictionary<string, string> { [IdentityTokens.SecretsEnv] = JsonSerializer.Serialize(new Dictionary<string, string> { ["app_shop"] = S(a, "secret"), ["app_rider"] = S(other, "secret") }) };
        Assert.Equal(S(other, "token"), IdentityTokens.CreateWith(false, null, null, Env(map), "user_42", "app_rider", null, at));
        Assert.Equal(S(a, "token"), IdentityTokens.CreateWith(false, null, null, Env(map), "user_42", "app_shop", null, at));
        var e = Assert.Throws<ConfigurationException>(() => IdentityTokens.CreateWith(false, null, null, Env(map), "user_42", null, null, at));
        Assert.Equal("missing_identity_secret", e.Code);
        Assert.Equal("appId", e.Param);
    }

    [Fact]
    public void Missing_and_malformed_secrets()
    {
        var missing = Assert.Throws<ConfigurationException>(() => IdentityTokens.CreateWith(false, null, null, Env([]), "user_42", null, null, 1));
        Assert.Equal("missing_identity_secret", missing.Code);
        var bad = new Dictionary<string, string> { [IdentityTokens.SecretsEnv] = "{not json" };
        var malformed = Assert.Throws<ConfigurationException>(() => IdentityTokens.CreateWith(false, null, null, Env(bad), "user_42", "app_shop", null, 1));
        Assert.Equal("invalid_identity_secrets", malformed.Code);
        Assert.DoesNotContain("not json", malformed.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Client_method_uses_its_options()
    {
        var a = Vector("ascii");
        var other = Vector("other_app_secret");
        using var c = new ClikgateClient(new ClikgateOptions
        {
            ApiKey = "cg_test_unit000000000000",
            ShutdownHooks = false,
            IdentitySecret = S(a, "secret"),
            IdentitySecrets = new Dictionary<string, string> { ["app_rider"] = S(other, "secret") },
        });
        var token = c.CreateIdentityToken("user_42");
        Assert.Equal(IdentityTokens.Create("user_42", S(a, "secret"), long.Parse(token[(token.LastIndexOf('.') + 1)..], System.Globalization.CultureInfo.InvariantCulture)), token);
        var rider = c.CreateIdentityToken("user_42", "app_rider");
        Assert.Equal(IdentityTokens.Create("user_42", S(other, "secret"), long.Parse(rider[(rider.LastIndexOf('.') + 1)..], System.Globalization.CultureInfo.InvariantCulture)), rider);
    }

    [Fact]
    public void Issued_at_defaults_to_now()
    {
        var before = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var token = IdentityTokens.CreateWith(false, "cgis_unit", null, Env([]), "user_42", null, null, null);
        var parts = token.Split('.');
        Assert.Equal(2, parts.Length);
        var issued = long.Parse(parts[1], System.Globalization.CultureInfo.InvariantCulture);
        Assert.InRange(issued, before, before + 2);
        Assert.Matches("^[A-Za-z0-9_-]{43}$", parts[0]);
    }

    [Fact]
    public void Invalid_customer_ids_are_refused_without_echo()
    {
        foreach (var bad in Doc.GetProperty("invalid_customer_ids").EnumerateArray())
        {
            var id = S(bad, "customer_id");
            var e = Assert.Throws<InvalidRequestException>(() => IdentityTokens.Create(id, "cgis_unit", 1));
            Assert.Equal("invalid_customer_id", e.Code);
            if (id.Length > 0)
            {
                Assert.DoesNotContain(id, e.Message, StringComparison.Ordinal);
            }
        }
        Assert.Throws<InvalidRequestException>(() => IdentityTokens.CreateWith(false, "cgis_unit", null, Env([]), null, null, null, 1));
        Assert.Throws<InvalidRequestException>(() => IdentityTokens.Create("user_42", "cgis_unit", -1));
    }

    [Fact]
    public void Refuses_maui_xamarin_and_browser_builds()
    {
        Assert.False(IdentityTokens.ClientPlatform, "this test host is a server");
        Assert.False(IdentityTokens.IsClientPlatform(_ => false, ["System.Private.CoreLib", "Microsoft.Maui.Graphics", "Clikgate"]));
        Assert.True(IdentityTokens.IsClientPlatform(_ => false, ["Microsoft.Maui"]));
        Assert.True(IdentityTokens.IsClientPlatform(_ => false, ["Mono.Android"]));
        Assert.True(IdentityTokens.IsClientPlatform(_ => false, ["Xamarin.iOS"]));
        Assert.True(IdentityTokens.IsClientPlatform(p => p == "ANDROID", []));
        Assert.True(IdentityTokens.IsClientPlatform(p => p == "IOS", []));
        Assert.True(IdentityTokens.IsClientPlatform(p => p == "BROWSER", []));
        var e = Assert.Throws<ClikgateServerOnlyException>(() => IdentityTokens.CreateWith(true, "cgis_unit", null, Env([]), "user_42", null, null, 1));
        Assert.IsAssignableFrom<ClikgateException>(e);
        Assert.Equal("server_only", e.Code);
        Assert.DoesNotContain("cgis_unit", e.Message, StringComparison.Ordinal);
    }
}
