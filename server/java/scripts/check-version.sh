#!/bin/sh
# Every POM version, Version.java and (on a tag) server-java-v<version> must agree; the core's only
# non-optional runtime dependency is jackson-databind (S.13).
set -eu
cd "$(dirname "$0")/.."
version=$(sed -n 's/.*public static final String VERSION = "\(.*\)";/\1/p' clikgate-java/src/main/java/com/clikgate/Version.java)
status=0
for pom in pom.xml clikgate-java/pom.xml clikgate-servlet-javax/pom.xml clikgate-servlet-jakarta/pom.xml ../java-spring-boot-starter/pom.xml; do
  v=$(grep -m1 -A0 '<version>' "$pom" | sed 's/.*<version>\(.*\)<\/version>.*/\1/')
  if [ "$v" != "$version" ]; then echo "$pom has $v, Version.java has $version" >&2; status=1; fi
done
case "${GITHUB_REF_NAME:-}" in
  server-java-v*) tag="${GITHUB_REF_NAME#server-java-v}"; if [ "$tag" != "$version" ]; then echo "tag says $tag, Version.java says $version" >&2; status=1; fi ;;
esac
deps=$(awk '/<dependencies>/,/<\/dependencies>/' clikgate-java/pom.xml | tr -d ' \n' | sed 's#</dependency>#\n#g' | grep -v '<optional>true</optional>' | grep -v '<scope>test</scope>' | sed -n 's#.*<artifactId>\(.*\)</artifactId>.*#\1#p')
if [ "$deps" != "jackson-databind" ]; then echo "clikgate-java runtime dependencies must be jackson-databind only, got: $deps" >&2; status=1; fi
[ $status -eq 0 ] && echo "version $version ok"
exit $status
