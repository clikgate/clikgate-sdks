<?php

declare(strict_types=1);

// src/Version.php and (on a tag) server-php-v<version> must agree; the runtime dependencies stay PSR + discovery (S.13).
$root = dirname(__DIR__);
preg_match("/VERSION = '([^']+)'/", (string) file_get_contents($root . '/src/Version.php'), $m);
$version = $m[1] ?? '';
$composer = json_decode((string) file_get_contents($root . '/composer.json'), true, 512, JSON_THROW_ON_ERROR);
$problems = [];
$ref = (string) getenv('GITHUB_REF_NAME');
if (str_starts_with($ref, 'server-php-v') && substr($ref, strlen('server-php-v')) !== $version) {
    $problems[] = "tag says {$ref}, src/Version.php says {$version}";
}
$allowed = ['php', 'php-http/discovery', 'psr/http-client', 'psr/http-factory', 'psr/http-message', 'psr/log'];
foreach (array_keys($composer['require'] ?? []) as $dep) {
    if (!in_array($dep, $allowed, true)) {
        $problems[] = "{$dep} is not an allowed runtime dependency (S.13: PSR interfaces + php-http/discovery)";
    }
}
if (isset($composer['version'])) {
    $problems[] = 'composer.json must not have a "version": Packagist reads the tag';
}
if ([] !== $problems) {
    fwrite(STDERR, implode("\n", $problems) . "\n");
    exit(1);
}
echo "version {$version} ok\n";
