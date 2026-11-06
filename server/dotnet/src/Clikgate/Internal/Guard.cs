using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Clikgate.Internal;

/// <summary>The private-mode guard (SPEC 12.2): refuses every non-allowed field before the HTTP layer sees it.</summary>
internal static class Guard
{
    public const string Redacted = "[redacted]";
    private static readonly string[] GoalFields = ["goal", "click_id", "code", "reference", "value", "currency", "is_first", "occurred_at", "consent", "provider", "kept_by", "browser_engine", "platform"];
    // hashed_*: SPEC 25; the API accepts them in private mode only while a destination matches by hashed email or phone
    private static readonly string[] HashedFields = ["hashed_email", "hashed_phone_e164", "hashed_phone_digits"];
    private static readonly string[] ConversionFields = [.. GoalFields, "external_id", .. HashedFields];
    // label: the API accepts it in private mode only with "Allow labels in private mode" (SPEC 24)
    private static readonly string[] GoalWithLabelFields = [.. GoalFields, "label", .. HashedFields];
    private static readonly string[] IdentifyFields = ["click_id", "app_id", "installation_id", "label"];
    private static readonly string[] ReversalFields = ["goal", "reference", "value", "external_id", "amount_minor"];
    private static readonly string[] PaymentConfirmationFields = ["provider", "reference", "status", "amount", "amount_minor", "currency", "occurred_at", "aliases", "click_id", "goal", "test", "refund_id", "source_plugin"];

    public static string[] Allowed(string kind) => kind switch
    {
        "goal" => GoalWithLabelFields,
        "conversion" => ConversionFields,
        "identify" => IdentifyFields,
        "payment_confirmation" => PaymentConfirmationFields,
        _ => ReversalFields,
    };

    public static void Check(string kind, JsonObject wire)
    {
        var allowed = Allowed(kind);
        var refused = wire.Where(kv => kv.Value is not null && Array.IndexOf(allowed, kv.Key) < 0).Select(kv => kv.Key).ToList();
        if (refused.Count == 0)
        {
            return;
        }
        static int Rank(string k) => k == "metadata" ? 0 : k == "consent" ? 1 : 2;
        refused.Sort((a, b) => Rank(a) != Rank(b) ? Rank(a).CompareTo(Rank(b)) : string.CompareOrdinal(a, b));
        var field = refused[0];
        throw new PrivateModeFieldRejectedException("Private mode is on: the field \"" + field + "\" can't be sent. Only " + string.Join(", ", allowed) + " are allowed.", field);
    }
}
