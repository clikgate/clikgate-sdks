<?php

declare(strict_types=1);

// src/Version.php and (on a tag) server-php-v<version> must agree; the runtime dependencies stay PSR + discovery.
$root = dirname(__DIR__);
preg_match("/VERSION = '([^']+)'/", (string) file_get_contents($root . '/src/Version.php'), $m);
$version = $m[1] ?? '';
$composer = json_decode((string) file_get_contents($root . '/composer.json'), true, 512, JSON_THROW_ON_ERROR);
$problems = [];
$ref = (string) getenv('GITHUB_REF_NAME');
if (str_starts_with($ref, 'server-php-v') && substr($ref, strlen('server-php-v')) !== $version) {
    $problems[] = "tag says {$ref}, src/Version.php says {$version}";
}
// README snippets and Laravel: the server SDK table, pinned versions and the Laravel constraint must name this version
$table = (string) file_get_contents(dirname($root) . '/README.md');
preg_match('/\| `clikgate\/clikgate-php`[^\n]*?\| (\d+\.\d+\.\d+)/', $table, $row);
if (($row[1] ?? null) !== $version) {
    $problems[] = 'server/README.md lists clikgate-php ' . ($row[1] ?? '(none)') . ", src/Version.php says {$version}";
}
foreach ([$root . '/README.md', dirname($root) . '/php-laravel/README.md'] as $readme) {
    preg_match_all('/clikgate\/clikgate-(?:php|laravel)[:" ]+\^?(\d+\.\d+\.\d+)/', (string) file_get_contents($readme), $pins);
    foreach ($pins[1] as $pin) {
        if ($pin !== $version) {
            $problems[] = basename(dirname($readme)) . "/README.md pins {$pin}, src/Version.php says {$version}";
        }
    }
}
$laravel = json_decode((string) file_get_contents(dirname($root) . '/php-laravel/composer.json'), true, 512, JSON_THROW_ON_ERROR);
if (($laravel['require']['clikgate/clikgate-php'] ?? null) !== '^' . $version) {
    $problems[] = 'php-laravel/composer.json requires clikgate/clikgate-php ' . ($laravel['require']['clikgate/clikgate-php'] ?? '(none)') . ", expected ^{$version}";
}
$allowed = ['php', 'php-http/discovery', 'psr/http-client', 'psr/http-factory', 'psr/http-message', 'psr/log'];
foreach (array_keys($composer['require'] ?? []) as $dep) {
    if (!in_array($dep, $allowed, true)) {
        $problems[] = "{$dep} is not an allowed runtime dependency (PSR interfaces + php-http/discovery)";
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
