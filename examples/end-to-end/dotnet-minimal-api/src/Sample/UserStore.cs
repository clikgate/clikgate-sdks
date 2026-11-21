using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json.Serialization;

namespace Sample;

/// <summary>A user of your app, as your own database stores it.</summary>
/// <param name="Id">Your own user ID: the same string goes to Clikgate as the customer ID, in the app and on the server.</param>
/// <param name="CreatedAt">When the account was created. Clikgate uses it to tell existing customers from new ones.</param>
public sealed record AppUser(string Id, string Email, DateTimeOffset CreatedAt, [property: JsonIgnore] string PasswordHash);

/// <summary>
/// Users and sessions, kept in memory so the sample runs with nothing else installed.
/// In your app this is your database (a users table) and your existing session or token handling.
/// </summary>
public sealed class UserStore
{
    private readonly ConcurrentDictionary<string, AppUser> _usersByEmail = new();
    private readonly ConcurrentDictionary<string, AppUser> _usersById = new();
    private readonly ConcurrentDictionary<string, string> _userIdsBySession = new();

    /// <summary>Creates the account, or returns null when the email is taken.</summary>
    public AppUser? Create(string email, string password)
    {
        var user = new AppUser($"user_{Guid.NewGuid():N}", email, DateTimeOffset.UtcNow, Passwords.Hash(password));
        if (!_usersByEmail.TryAdd(email, user)) return null;
        _usersById[user.Id] = user;
        return user;
    }

    /// <summary>Your own sign-in check: the user when the email and password match.</summary>
    public AppUser? SignIn(string email, string password) =>
        _usersByEmail.TryGetValue(email, out var user) && Passwords.Matches(password, user.PasswordHash) ? user : null;

    public string StartSession(AppUser user)
    {
        var accessToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
        _userIdsBySession[accessToken] = user.Id;
        return accessToken;
    }

    public AppUser? FindBySession(string accessToken) =>
        _userIdsBySession.TryGetValue(accessToken, out var id) && _usersById.TryGetValue(id, out var user) ? user : null;

    /// <summary>Resolves "Authorization: Bearer &lt;access token&gt;". Stands in for your real authentication.</summary>
    public AppUser? FromRequest(HttpRequest request)
    {
        var header = request.Headers.Authorization.ToString();
        return header.StartsWith("Bearer ", StringComparison.Ordinal) ? FindBySession(header["Bearer ".Length..]) : null;
    }
}

/// <summary>Salted PBKDF2 hashes, so even the sample never keeps a plain password. Use your framework's own.</summary>
internal static class Passwords
{
    private const int Iterations = 210_000;

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        return $"{Convert.ToBase64String(salt)}:{Convert.ToBase64String(Derive(password, salt))}";
    }

    public static bool Matches(string password, string stored)
    {
        var parts = stored.Split(':');
        return CryptographicOperations.FixedTimeEquals(Convert.FromBase64String(parts[1]), Derive(password, Convert.FromBase64String(parts[0])));
    }

    private static byte[] Derive(string password, byte[] salt) =>
        Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, 32);
}
