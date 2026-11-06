package com.clikgate.internal;

import com.clikgate.Version;
import java.util.Locale;

/** Internal: the User-Agent (SPEC section 4); the only telemetry the SDK sends. */
public final class UserAgent {
  private UserAgent() {}

  /** Versions must match {@code ^[0-9][0-9A-Za-z.+-]{0,39}$}: Java's {@code 1.8.0_402} becomes {@code 1.8.0-402}. */
  public static String sanitise(String version) {
    String v = version.startsWith("v") ? version.substring(1) : version;
    v = v.replaceAll("[^0-9A-Za-z.+-]", "-");
    return v.length() > 40 ? v.substring(0, 40) : v;
  }

  public static String os(String osName) {
    String n = osName.toLowerCase(Locale.ROOT);
    if (n.startsWith("windows")) {
      return "windows";
    }
    if (n.startsWith("mac") || n.contains("darwin")) {
      return "darwin";
    }
    if (n.startsWith("linux")) {
      return "linux";
    }
    String compact = n.replaceAll("[^a-z0-9]", "");
    return compact.isEmpty() ? "unknown" : compact;
  }

  public static String arch(String osArch) {
    String a = osArch.toLowerCase(Locale.ROOT).replace(" ", "");
    switch (a) {
      case "amd64":
      case "x86_64":
      case "x64":
        return "x64";
      case "aarch64":
      case "arm64":
        return "arm64";
      case "x86":
      case "i386":
      case "i486":
      case "i586":
      case "i686":
        return "x86";
      default:
        return a.startsWith("arm") ? "arm" : a.isEmpty() ? "unknown" : a;
    }
  }

  public static String build(String osName, String osArch, String javaVersion) {
    return "clikgate-java/" + sanitise(Version.VERSION) + " (java " + sanitise(javaVersion) + "; " + os(osName) + " " + arch(osArch) + ")";
  }

  public static String current() {
    return build(System.getProperty("os.name", "unknown"), System.getProperty("os.arch", "unknown"), System.getProperty("java.version", "0"));
  }
}
