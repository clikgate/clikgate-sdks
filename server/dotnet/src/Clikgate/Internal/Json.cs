using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Clikgate.Internal;

/// <summary>JSON with System.Text.Json. Decimals stay exact; dates become RFC 3339 UTC; explicit nulls in maps are kept.</summary>
internal static class Json
{
    public static JsonNode? Parse(byte[] body)
    {
        var text = Encoding.UTF8.GetString(body);
        return string.IsNullOrWhiteSpace(text) ? null : JsonNode.Parse(text);
    }

    public static byte[] Write(object? value) => Encoding.UTF8.GetBytes(ToNode(value)?.ToJsonString() ?? "null");

    public static JsonNode? ToNode(object? value)
    {
        switch (value)
        {
            case null:
                return null;
            case JsonNode n:
                return n.DeepClone();
            case JsonElement e:
                return JsonNode.Parse(e.GetRawText());
            case string s:
                return JsonValue.Create(s);
            case bool b:
                return JsonValue.Create(b);
            case DateTimeOffset or DateTime:
                return JsonValue.Create(Dates.Format(value));
            case decimal d:
                return JsonValue.Create(d);
            case double dbl:
                return JsonValue.Create(dbl);
            case float f:
                return JsonValue.Create(f);
            case int or long or short or byte or uint or ulong or ushort or sbyte:
                return JsonValue.Create(Convert.ToInt64(value, CultureInfo.InvariantCulture));
            case Provider p:
                return JsonValue.Create(p.Value);
            case GoalKind kind:
                return JsonValue.Create(kind.ToWire());
            case GoalStatus goalStatus:
                return JsonValue.Create(goalStatus.ToWire());
            case Enum en:
                return JsonValue.Create(en.ToString());
            case IDictionary dict:
                {
                    var o = new JsonObject();
                    foreach (DictionaryEntry entry in dict)
                    {
                        o[Convert.ToString(entry.Key, CultureInfo.InvariantCulture) ?? string.Empty] = ToNode(entry.Value);
                    }
                    return o;
                }
            case IEnumerable<KeyValuePair<string, object?>> pairs:
                {
                    var o = new JsonObject();
                    foreach (var kv in pairs)
                    {
                        o[kv.Key] = ToNode(kv.Value);
                    }
                    return o;
                }
            case IEnumerable items:
                {
                    var a = new JsonArray();
                    foreach (var item in items)
                    {
                        a.Add(ToNode(item));
                    }
                    return a;
                }
            default:
                return JsonValue.Create(Convert.ToString(value, CultureInfo.InvariantCulture));
        }
    }

    public static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue(out string? s) ? s : null;

    public static bool? Bool(JsonNode? n) => n is JsonValue v && v.TryGetValue(out bool b) ? b : null;

    public static int? Int(JsonNode? n)
    {
        if (n is not JsonValue v)
        {
            return null;
        }
        if (v.TryGetValue(out int i))
        {
            return i;
        }
        if (v.TryGetValue(out long l))
        {
            return (int)l;
        }
        if (v.TryGetValue(out decimal d))
        {
            return (int)d;
        }
        if (v.TryGetValue(out JsonElement e) && e.ValueKind == JsonValueKind.Number && e.TryGetInt32(out var ei))
        {
            return ei;
        }
        return null;
    }
}

/// <summary>RFC 3339 UTC (<c>YYYY-MM-DDTHH:MM:SSZ</c>, with <c>.sss</c> only when the milliseconds aren't zero).</summary>
internal static class Dates
{
    public static string Format(object value)
    {
        if (value is string str)
        {
            return str;
        }
        DateTimeOffset dto = value switch
        {
            DateTimeOffset d => d,
            DateTime dt when dt.Kind == DateTimeKind.Unspecified => throw Errors.Local("invalid_argument", "DateTime values must have DateTimeKind.Utc or Local (or use DateTimeOffset).", "occurred_at"),
            DateTime dt => new DateTimeOffset(dt),
            _ => throw new ArgumentException("Not a date: " + value.GetType().Name),
        };
        var u = dto.ToUniversalTime();
        var ms = u.Millisecond;
        return u.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture) + (ms > 0 ? "." + ms.ToString("000", CultureInfo.InvariantCulture) + "Z" : "Z");
    }
}
