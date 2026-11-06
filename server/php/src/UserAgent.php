<?php

declare(strict_types=1);

namespace Clikgate;

/** @internal The User-Agent (SPEC section 4); the only telemetry the SDK sends. */
final class UserAgent
{
    private const ARCH = ['x86_64' => 'x64', 'amd64' => 'x64', 'x64' => 'x64', 'aarch64' => 'arm64', 'arm64' => 'arm64', 'i386' => 'x86', 'i686' => 'x86', 'x86' => 'x86'];

    /** Versions must match `^[0-9][0-9A-Za-z.+-]{0,39}$` for the backend parser. */
    public static function sanitise(string $version): string
    {
        $v = str_starts_with($version, 'v') ? substr($version, 1) : $version;

        return substr((string) preg_replace('/[^0-9A-Za-z.+-]/', '-', $v), 0, 40);
    }

    public static function arch(string $machine): string
    {
        $m = strtolower(str_replace(' ', '', $machine));
        if (isset(self::ARCH[$m])) {
            return self::ARCH[$m];
        }

        return str_starts_with($m, 'armv') || 'arm' === $m ? 'arm' : ('' === $m ? 'unknown' : $m);
    }

    public static function build(?string $os = null, ?string $machine = null, ?string $phpVersion = null): string
    {
        $osName = strtolower(str_replace(' ', '', $os ?? \PHP_OS_FAMILY));
        $osName = ['winnt' => 'windows', 'win32' => 'windows'][$osName] ?? $osName;

        return \sprintf(
            'clikgate-php/%s (php %s; %s %s)',
            self::sanitise(Version::VERSION),
            self::sanitise($phpVersion ?? \PHP_VERSION),
            '' === $osName ? 'unknown' : $osName,
            self::arch($machine ?? php_uname('m')),
        );
    }
}
