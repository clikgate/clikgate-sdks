using System;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace Clikgate.Internal;

/// <summary>The User-Agent (SPEC section 4): the only telemetry the SDK sends.</summary>
internal static class UserAgent
{
    private static readonly Regex Bad = new("[^0-9A-Za-z.+-]", RegexOptions.CultureInvariant);

    public static string Sanitise(string version)
    {
        var v = version.StartsWith("v", StringComparison.Ordinal) ? version.Substring(1) : version;
        v = Bad.Replace(v, "-");
        return v.Length > 40 ? v.Substring(0, 40) : v;
    }

    public static string Os()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return "windows";
        }
        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            return "darwin";
        }
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            return "linux";
        }
        var d = RuntimeInformation.OSDescription.Split(' ')[0].ToLowerInvariant();
        return string.IsNullOrEmpty(d) ? "unknown" : Regex.Replace(d, "[^a-z0-9]", string.Empty);
    }

    public static string Arch(Architecture a) => a switch
    {
        Architecture.X64 => "x64",
        Architecture.Arm64 => "arm64",
        Architecture.X86 => "x86",
        Architecture.Arm => "arm",
        _ => a.ToString().ToLowerInvariant().Replace(" ", string.Empty),
    };

    public static string Build(string os, string arch, string runtimeVersion) => "clikgate-dotnet/" + Sanitise(SdkVersion.Value) + " (dotnet " + Sanitise(runtimeVersion) + "; " + os + " " + arch + ")";

    public static string Current() => Build(Os(), Arch(RuntimeInformation.OSArchitecture), Environment.Version.ToString());
}
