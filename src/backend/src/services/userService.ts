import crypto from 'crypto';
import { prisma } from '../config/db';
import { sendDeletionConfirmationEmail } from './emailService';

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

export interface DeletionTokenResponse {
  email: string;
  deletionToken: string;
  expiresAt: string;
}

interface StoredToken {
  email: string;
  token: string;
  expiresAt: Date;
}

interface UserMemoryRecord {
  id: string;
  email: string;
  username?: string;
  deletionToken?: string;
  deletionTokenExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const tokenMemoryStore = new Map<string, StoredToken>();
const userMemoryStore = new Map<string, UserMemoryRecord>();

export async function upsertUserProfile(req: UpsertProfileRequest): Promise<UserProfileDTO> {
  const { email, username } = req;
  const cleanEmail = email.trim().toLowerCase();
  const cleanUsername = username ? username.trim() : undefined;

  let userRecord: { id: string; email: string; username?: string | null; createdAt: Date; updatedAt: Date } | null = null;
  const existingMem = userMemoryStore.get(cleanEmail);

  try {
    userRecord = await prisma.user.upsert({
      where: { email: cleanEmail },
      update: {
        ...(cleanUsername && { username: cleanUsername }),
      },
      create: {
        ...(existingMem && { id: existingMem.id }),
        email: cleanEmail,
        username: cleanUsername,
      },
    });
    userMemoryStore.set(cleanEmail, {
      id: userRecord.id,
      email: userRecord.email,
      username: userRecord.username || undefined,
      createdAt: userRecord.createdAt,
      updatedAt: userRecord.updatedAt,
    });
  } catch (_) {
    const now = new Date();
    const memUser: UserMemoryRecord = {
      id: existingMem ? existingMem.id : `usr_${crypto.randomBytes(8).toString('hex')}`,
      email: cleanEmail,
      username: cleanUsername || existingMem?.username,
      createdAt: existingMem ? existingMem.createdAt : now,
      updatedAt: now,
    };
    userMemoryStore.set(cleanEmail, memUser);
    userRecord = memUser;
  }

  const greetingName = userRecord.username || userRecord.email.split('@')[0];
  const welcomeMessage = `Welcome to Capital FM, ${greetingName}!`;

  return {
    id: userRecord.id,
    email: userRecord.email,
    username: userRecord.username || undefined,
    welcomeMessage,
    createdAt: userRecord.createdAt.toISOString(),
    updatedAt: userRecord.updatedAt.toISOString(),
  };
}

export async function getUserProfileByEmail(email: string): Promise<UserProfileDTO | null> {
  const cleanEmail = email.trim().toLowerCase();
  let userRecord: { id: string; email: string; username?: string | null; createdAt: Date; updatedAt: Date } | null = null;

  try {
    userRecord = await prisma.user.findUnique({
      where: { email: cleanEmail },
    });
    if (userRecord) {
      userMemoryStore.set(cleanEmail, {
        id: userRecord.id,
        email: userRecord.email,
        username: userRecord.username || undefined,
        createdAt: userRecord.createdAt,
        updatedAt: userRecord.updatedAt,
      });
    }
  } catch (_) {
    userRecord = userMemoryStore.get(cleanEmail) || null;
  }

  if (!userRecord && userMemoryStore.has(cleanEmail)) {
    userRecord = userMemoryStore.get(cleanEmail)!;
  }

  if (!userRecord) return null;

  const greetingName = userRecord.username || userRecord.email.split('@')[0];
  const welcomeMessage = `Welcome back to Capital FM, ${greetingName}!`;

  return {
    id: userRecord.id,
    email: userRecord.email,
    username: userRecord.username || undefined,
    welcomeMessage,
    createdAt: userRecord.createdAt.toISOString(),
    updatedAt: userRecord.updatedAt.toISOString(),
  };
}

export async function deleteUserProfile(email: string): Promise<boolean> {
  const cleanEmail = email.trim().toLowerCase();
  let found = false;

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email: cleanEmail },
    });

    if (existingUser) {
      await prisma.user.delete({
        where: { email: cleanEmail },
      });
      found = true;
    }
  } catch (_) {
    // Fallback check memory store
  }

  if (userMemoryStore.has(cleanEmail)) {
    userMemoryStore.delete(cleanEmail);
    found = true;
  }

  return found;
}

/**
 * Step 3: Server generates and returns a deletion token to app.
 */
export async function createDeletionToken(email: string): Promise<DeletionTokenResponse> {
  const cleanEmail = email.trim().toLowerCase();

  // Ensure user profile exists or create placeholder
  try {
    let user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) {
      await prisma.user.create({ data: { email: cleanEmail } });
    }
  } catch (_) {
    if (!userMemoryStore.has(cleanEmail)) {
      const now = new Date();
      userMemoryStore.set(cleanEmail, {
        id: `usr_${crypto.randomBytes(8).toString('hex')}`,
        email: cleanEmail,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const deletionToken = `del_${crypto.randomBytes(24).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  try {
    await prisma.user.update({
      where: { email: cleanEmail },
      data: {
        deletionToken,
        deletionTokenExpiresAt: expiresAt,
      },
    });
  } catch (_) {}

  tokenMemoryStore.set(cleanEmail, { email: cleanEmail, token: deletionToken, expiresAt });
  tokenMemoryStore.set(deletionToken, { email: cleanEmail, token: deletionToken, expiresAt });

  return {
    email: cleanEmail,
    deletionToken,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Step 5: Server verifies deletion token and sends deep link to customer's email.
 */
export async function processSendDeletionLink(
  email: string,
  deletionToken: string,
  deletionLink: string
): Promise<{ success: boolean; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanToken = deletionToken.trim();

  const isValid = await verifyDeletionToken(cleanEmail, cleanToken);
  if (!isValid) {
    return { success: false, error: 'Invalid or expired deletion token.' };
  }

  const sent = await sendDeletionConfirmationEmail(cleanEmail, deletionLink);
  if (!sent) {
    return { success: false, error: 'Failed to send deletion confirmation email.' };
  }

  return { success: true };
}

/**
 * Step 7 & 8: Confirmation sent to backend for actual complete deletion.
 */
export async function confirmAndDeleteAccount(
  email: string | undefined,
  deletionToken: string
): Promise<{ success: boolean; email?: string; error?: string }> {
  const cleanToken = deletionToken ? deletionToken.trim() : '';
  if (!cleanToken) {
    return { success: false, error: 'Deletion token is required.' };
  }

  let targetEmail = email ? email.trim().toLowerCase() : undefined;

  if (!targetEmail) {
    const memEntry = tokenMemoryStore.get(cleanToken);
    if (memEntry) {
      targetEmail = memEntry.email;
    } else {
      try {
        const userWithToken = await prisma.user.findFirst({
          where: { deletionToken: cleanToken },
        });
        if (userWithToken) {
          targetEmail = userWithToken.email;
        }
      } catch (_) {}
    }
  }

  if (!targetEmail) {
    return { success: false, error: 'Invalid or expired deletion token.' };
  }

  const isValid = await verifyDeletionToken(targetEmail, cleanToken);
  if (!isValid) {
    return { success: false, error: 'Invalid or expired deletion token.' };
  }

  const deleted = await deleteUserProfile(targetEmail);

  tokenMemoryStore.delete(targetEmail);
  tokenMemoryStore.delete(cleanToken);

  if (!deleted) {
    return { success: false, error: 'User profile not found or already deleted.' };
  }

  return { success: true, email: targetEmail };
}

/**
 * Helper to verify deletion token validity & expiry
 */
export async function verifyDeletionToken(email: string, token: string): Promise<boolean> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanToken = token.trim();

  const memEntry = tokenMemoryStore.get(cleanToken) || tokenMemoryStore.get(cleanEmail);
  if (memEntry && memEntry.token === cleanToken) {
    if (memEntry.expiresAt.getTime() > Date.now()) {
      return true;
    }
    tokenMemoryStore.delete(cleanEmail);
    tokenMemoryStore.delete(cleanToken);
    return false;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: cleanEmail },
    });
    if (
      user &&
      (user as any).deletionToken === cleanToken &&
      (user as any).deletionTokenExpiresAt &&
      new Date((user as any).deletionTokenExpiresAt).getTime() > Date.now()
    ) {
      return true;
    }
  } catch (_) {}

  return false;
}
