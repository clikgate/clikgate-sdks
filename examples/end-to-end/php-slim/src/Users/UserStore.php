<?php

declare(strict_types=1);

namespace App\Users;

use App\State;

/** Users and sessions. In your app: your users table and your existing session or token handling. */
final class UserStore
{
    public function __construct(private readonly State $state) {}

    /** Creates the account, or returns null when the email is taken. */
    public function create(string $email, string $password): ?AppUser
    {
        if (null !== $this->findByEmail($email)) {
            return null;
        }
        $user = new AppUser(
            'user_' . bin2hex(random_bytes(12)),
            $email,
            new \DateTimeImmutable('now', new \DateTimeZone('UTC')),
            password_hash($password, \PASSWORD_DEFAULT),
        );
        $this->state->tables['users'][$user->id] = [
            'id' => $user->id,
            'email' => $email,
            'created_at' => $user->createdAt->format(\DATE_ATOM),
            'password_hash' => $user->passwordHash,
        ];

        return $user;
    }

    /** Your own sign-in check: the user when the email and password match. */
    public function signIn(string $email, string $password): ?AppUser
    {
        $user = $this->findByEmail($email);

        return null !== $user && password_verify($password, $user->passwordHash) ? $user : null;
    }

    public function startSession(AppUser $user): string
    {
        $accessToken = bin2hex(random_bytes(24));
        $this->state->tables['sessions'][$accessToken] = $user->id;

        return $accessToken;
    }

    public function findBySession(string $accessToken): ?AppUser
    {
        $userId = $this->state->tables['sessions'][$accessToken] ?? null;
        $row = \is_string($userId) ? ($this->state->tables['users'][$userId] ?? null) : null;

        return \is_array($row) ? self::fromRow($row) : null;
    }

    private function findByEmail(string $email): ?AppUser
    {
        foreach ($this->state->tables['users'] as $row) {
            if ($row['email'] === $email) {
                return self::fromRow($row);
            }
        }

        return null;
    }

    /** @param array<string, string> $row */
    private static function fromRow(array $row): AppUser
    {
        return new AppUser($row['id'], $row['email'], new \DateTimeImmutable($row['created_at']), $row['password_hash']);
    }
}
