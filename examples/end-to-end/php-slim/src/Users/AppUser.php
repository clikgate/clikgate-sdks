<?php

declare(strict_types=1);

namespace App\Users;

/** A user of your app, as your own database stores it. */
final class AppUser implements \JsonSerializable
{
    public function __construct(
        /** Your own user ID: the same string goes to Clikgate as the customer ID, in the app and on the server. */
        public readonly string $id,
        public readonly string $email,
        /** When the account was created. Clikgate uses it to tell existing customers from new ones. */
        public readonly \DateTimeImmutable $createdAt,
        public readonly string $passwordHash,
    ) {}

    public function jsonSerialize(): array
    {
        return ['id' => $this->id, 'email' => $this->email, 'createdAt' => $this->createdAt->format(\DATE_ATOM)];
    }
}
