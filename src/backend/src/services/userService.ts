import { prisma } from '../config/db';

export interface UserProfileDTO {
  id: string;
  email: string;
  username?: string;
  welcomeMessage: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertProfileRequest {
  email: string;
  username?: string;
}

export async function upsertUserProfile(req: UpsertProfileRequest): Promise<UserProfileDTO> {
  const { email, username } = req;
  const cleanEmail = email.trim().toLowerCase();
  const cleanUsername = username ? username.trim() : undefined;

  const user = await prisma.user.upsert({
    where: { email: cleanEmail },
    update: {
      ...(cleanUsername && { username: cleanUsername }),
    },
    create: {
      email: cleanEmail,
      username: cleanUsername,
    },
  });

  const greetingName = user.username || user.email.split('@')[0];
  const welcomeMessage = `Welcome to Capital FM, ${greetingName}!`;

  return {
    id: user.id,
    email: user.email,
    username: user.username || undefined,
    welcomeMessage,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function getUserProfileByEmail(email: string): Promise<UserProfileDTO | null> {
  const cleanEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: cleanEmail },
  });

  if (!user) return null;

  const greetingName = user.username || user.email.split('@')[0];
  const welcomeMessage = `Welcome back to Capital FM, ${greetingName}!`;

  return {
    id: user.id,
    email: user.email,
    username: user.username || undefined,
    welcomeMessage,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
