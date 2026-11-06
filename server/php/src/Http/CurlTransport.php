<?php

declare(strict_types=1);

namespace Clikgate\Http;

use Clikgate\Exception\ClikgateNetworkException;
use Clikgate\Exception\ClikgateTimeoutException;

/**
 * @internal The built-in transport (ext-curl): keep-alive, per-attempt timeout, explicit or system proxy
 * (libcurl reads `https_proxy`/`HTTPS_PROXY`/`NO_PROXY`), HTTPS CONNECT tunnelling, never follows redirects.
 */
final class CurlTransport implements Transport
{
    private ?\CurlHandle $handle = null;

    /**
     * @param string|false|null $proxy an `http(s)://user:pass@host:port` URL, false to ignore the environment, null for the environment
     */
    public function __construct(private readonly string|false|null $proxy = null) {}

    public function send(string $method, string $url, array $headers, ?string $body, float $timeout): RawResponse
    {
        if ('' === $url || '' === $method) {
            throw new ClikgateNetworkException('Empty URL or method.', 'network_error');
        }
        $h = $this->handle ??= curl_init() ?: throw new ClikgateNetworkException('Could not initialise curl.', 'network_error');
        curl_reset($h);
        $lines = ['Expect:'];
        foreach ($headers as $k => $v) {
            $lines[] = "{$k}: {$v}";
        }
        $responseHeaders = [];
        $ms = max(1, (int) round($timeout * 1000));
        $options = [
            \CURLOPT_URL => $url,
            \CURLOPT_CUSTOMREQUEST => $method,
            \CURLOPT_HTTPHEADER => $lines,
            \CURLOPT_RETURNTRANSFER => true,
            \CURLOPT_FOLLOWLOCATION => false,
            \CURLOPT_TIMEOUT_MS => $ms,
            \CURLOPT_CONNECTTIMEOUT_MS => $ms,
            \CURLOPT_NOSIGNAL => true,
            \CURLOPT_ENCODING => '',
            \CURLOPT_PROTOCOLS => \CURLPROTO_HTTP | \CURLPROTO_HTTPS,
            \CURLOPT_HEADERFUNCTION => static function ($_ch, string $line) use (&$responseHeaders): int {
                $parts = explode(':', $line, 2);
                if (2 === \count($parts)) {
                    $k = strtolower(trim($parts[0]));
                    $v = trim($parts[1]);
                    $responseHeaders[$k] = isset($responseHeaders[$k]) ? "{$responseHeaders[$k]}, {$v}" : $v;
                } elseif (str_starts_with($line, 'HTTP/')) {
                    $responseHeaders = []; // a new response (e.g. after a proxy's 200 Connection established)
                }

                return \strlen($line);
            },
        ];
        if (null !== $body) {
            $options[\CURLOPT_POSTFIELDS] = $body;
        }
        if (false === $this->proxy) {
            $options[\CURLOPT_PROXY] = '';
        } elseif (\is_string($this->proxy)) {
            $options[\CURLOPT_PROXY] = $this->proxy;
            $options[\CURLOPT_PROXYAUTH] = \CURLAUTH_BASIC;
        }
        curl_setopt_array($h, $options);
        $result = curl_exec($h);
        if (false === $result || !\is_string($result)) {
            $errno = curl_errno($h);
            if (\CURLE_OPERATION_TIMEDOUT === $errno) {
                throw new ClikgateTimeoutException(\sprintf('The request timed out after %d ms.', $ms), 'timeout');
            }
            throw new ClikgateNetworkException(\sprintf('Could not reach the Clikgate API (curl error %d).', $errno), 'network_error');
        }

        /** @var array<string, string> $responseHeaders */
        return new RawResponse((int) curl_getinfo($h, \CURLINFO_RESPONSE_CODE), $responseHeaders, $result);
    }
}
