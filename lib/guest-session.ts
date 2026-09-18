import crypto from "node:crypto";

export const guestSessionCookie = {
  name: "epia_guest",
  options: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  },
};

export function newGuestId() {
  return crypto.randomBytes(32).toString("base64url");
}

export function guestIdentityKey(guestId: string) {
  return `guest:${guestId}`;
}
