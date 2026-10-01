import bcrypt from "bcryptjs";

const COST = 12;
// bcrypt only uses the first 72 bytes; validation caps passwords well below that.
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Pre-computed hash used to keep login timing constant when the email does not exist.
export const DUMMY_HASH = "$2a$12$dSMZ0KSxct7.n1B/6uuSzOw68.s9MYHktLmUGpspL3B7tyUZ1RPc2";
