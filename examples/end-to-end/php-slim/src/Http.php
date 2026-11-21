<?php

declare(strict_types=1);

namespace App;

use App\Users\AppUser;
use App\Users\UserStore;
use Clikgate\Installation;
use Clikgate\Psr15\ClikgateMiddleware;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Small helpers the routes share. */
final class Http
{
    /** @param array<string, mixed>|\JsonSerializable $data */
    public static function json(Response $response, array|\JsonSerializable $data, int $status = 200): Response
    {
        $response->getBody()->write(json_encode($data, \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES));

        return $response->withStatus($status)->withHeader('Content-Type', 'application/json');
    }

    public static function field(Request $request, string $name): string
    {
        $body = $request->getParsedBody();

        return \is_array($body) && \is_string($body[$name] ?? null) ? $body[$name] : '';
    }

    /** The app's installation, read from the `Clikgate-Installation` header by the SDK's PSR-15 middleware. */
    public static function installation(Request $request): ?Installation
    {
        $installation = $request->getAttribute(ClikgateMiddleware::INSTALLATION_ATTRIBUTE);

        return $installation instanceof Installation ? $installation : null;
    }

    /**
     * Resolves "Authorization: Bearer <access token>" to the signed-in user. Stands in for your real authentication.
     * Everything Clikgate needs about the user comes from here, never from the request body.
     */
    public static function signedInUser(Request $request, UserStore $users): ?AppUser
    {
        $header = $request->getHeaderLine('Authorization');

        return str_starts_with($header, 'Bearer ') ? $users->findBySession(substr($header, 7)) : null;
    }
}
