#!/bin/sh
# Directory.Build.props <Version>, SdkVersion.Value and (on a tag) server-dotnet-v<version> must agree; the core
# package's only dependency is System.Text.Json, on netstandard2.0 only (S.13).
set -eu
cd "$(dirname "$0")/.."
props=$(sed -n 's/.*<Version>\(.*\)<\/Version>.*/\1/p' Directory.Build.props)
code=$(sed -n 's/.*public const string Value = "\(.*\)";/\1/p' src/Clikgate/Version.cs)
status=0
[ "$props" = "$code" ] || { echo "Directory.Build.props says $props, SdkVersion says $code" >&2; status=1; }
case "${GITHUB_REF_NAME:-}" in
  server-dotnet-v*) tag="${GITHUB_REF_NAME#server-dotnet-v}"; [ "$tag" = "$props" ] || { echo "tag says $tag, the projects say $props" >&2; status=1; } ;;
esac
refs=$(grep -o 'PackageReference Include="[^"]*"' src/Clikgate/Clikgate.csproj | sed 's/.*Include="\(.*\)"/\1/' | tr '\n' ' ')
[ "$refs" = "System.Text.Json " ] || { echo "Clikgate may only reference System.Text.Json (netstandard2.0), got: $refs" >&2; status=1; }
[ $status -eq 0 ] && echo "version $props ok"
exit $status
