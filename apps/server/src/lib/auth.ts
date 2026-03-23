import { Lucia, TimeSpan } from "lucia";
import { PrismaAdapter } from "@lucia-auth/adapter-prisma";
import { GitHub, Google } from "arctic";
import { prisma } from "./prisma";
import { env } from "../config/env";
import { COOKIE_NAME } from "../config/constants";

const adapter = new PrismaAdapter(prisma.authSession, prisma.user);

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    name: COOKIE_NAME,
    attributes: {
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
    },
    expires: true,
  },
  sessionExpiresIn: new TimeSpan(36500, "d"),
  getUserAttributes: (attributes) => ({
    email: attributes.email,
    name: attributes.name,
    avatarUrl: attributes.avatarUrl,
    githubId: attributes.githubId,
    googleId: attributes.googleId,
  }),
});

export const github = new GitHub(
  env.GITHUB_CLIENT_ID,
  env.GITHUB_CLIENT_SECRET,
  env.GITHUB_REDIRECT_URI
);

export const google = new Google(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URI
);

declare module "lucia" {
  interface Register {
    Lucia: typeof lucia;
    DatabaseUserAttributes: {
      email: string;
      name: string | null;
      avatarUrl: string | null;
      githubId: string | null;
      googleId: string | null;
    };
  }
}
