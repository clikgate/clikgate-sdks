import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

/** A user of your app, as your own database stores it. */
export interface AppUser {
  /** Your own user ID: the same string goes to Clikgate as the customer ID, in the app and on the server. */
  id: string;
  email: string;
  /** When the account was created. Clikgate uses it to tell existing customers from new ones. */
  createdAt: Date;
}

interface StoredUser extends AppUser {
  passwordHash: string;
}

/**
 * Users and sessions, kept in memory so the sample runs with nothing else installed.
 * In your app this is your database (a users table) and your existing session or token handling.
 */
export class UserStore {
  private readonly usersByEmail = new Map<string, StoredUser>();
  private readonly usersById = new Map<string, StoredUser>();
  private readonly userIdsBySession = new Map<string, string>();

  /** Creates the account, or returns null when the email is taken. */
  create(email: string, password: string): AppUser | null {
    if (this.usersByEmail.has(email)) return null;
    const user: StoredUser = { id: `user_${randomUUID()}`, email, createdAt: new Date(), passwordHash: hashPassword(password) };
    this.usersByEmail.set(email, user);
    this.usersById.set(user.id, user);
    return publicView(user);
  }

  /** Your own sign-in check: the user when the email and password match. */
  signIn(email: string, password: string): AppUser | null {
    const user = this.usersByEmail.get(email);
    return user && passwordMatches(password, user.passwordHash) ? publicView(user) : null;
  }

  startSession(user: AppUser): string {
    const accessToken = randomUUID();
    this.userIdsBySession.set(accessToken, user.id);
    return accessToken;
  }

  findBySession(accessToken: string): AppUser | null {
    const user = this.usersById.get(this.userIdsBySession.get(accessToken) ?? '');
    return user ? publicView(user) : null;
  }
}

function publicView({ id, email, createdAt }: StoredUser): AppUser {
  return { id, email, createdAt };
}

// Salted scrypt hashes, so even the sample never keeps a plain password. Use your framework's own.
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('base64')}:${scryptSync(password, salt, 32).toString('base64')}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const [salt = '', hash = ''] = stored.split(':');
  return timingSafeEqual(Buffer.from(hash, 'base64'), scryptSync(password, Buffer.from(salt, 'base64'), 32));
}
