import { Request, Response, NextFunction } from 'express';
import {
  upsertUserProfile,
  getUserProfileByEmail,
  deleteUserProfile,
  createDeletionToken,
  processSendDeletionLink,
  confirmAndDeleteAccount,
} from '../services/userService';
import { getUserFavorites, addFavorite, removeFavorite } from '../services/favoriteService';

export async function upsertProfileHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const email = req.body.email || req.user?.email;
    const username = req.body.username || req.user?.username;

    if (!email) {
      res.status(400).json({
        status: 'error',
        message: 'Email address is required to register or update user profile.',
      });
      return;
    }

    const profile = await upsertUserProfile({ email, username });

    res.status(200).json({
      status: 'success',
      data: profile,
    });
  } catch (error) {
    next(error);
  }
}

export async function getProfileHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const email = req.user?.email;
    if (!email) {
      res.status(401).json({ status: 'error', message: 'Unauthorized.' });
      return;
    }

    let profile = await getUserProfileByEmail(email);
    if (!profile) {
      profile = await upsertUserProfile({ email, username: req.user?.username });
    }

    res.status(200).json({
      status: 'success',
      data: profile,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteProfileHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const email = req.user?.email || req.body?.email || (req.query?.email as string);

    if (!email) {
      res.status(400).json({
        status: 'error',
        message: 'Email address is required to delete profile.',
      });
      return;
    }

    const deleted = await deleteUserProfile(email);

    if (!deleted) {
      res.status(404).json({
        status: 'error',
        message: `User profile with email '${email}' was not found or has already been deleted.`,
      });
      return;
    }

    res.status(200).json({
      status: 'success',
      message: 'User profile and all associated data have been permanently deleted.',
      data: {
        email: email.trim().toLowerCase(),
        deletedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Step 2 & 3: User/App requests profile deletion. Server returns a deletion token to app.
 */
export async function requestDeletionHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const email = req.body?.email || req.user?.email;

    if (!email) {
      res.status(400).json({
        status: 'error',
        message: 'Email address is required to request profile deletion.',
      });
      return;
    }

    const tokenData = await createDeletionToken(email);

    res.status(200).json({
      status: 'success',
      message: 'Deletion token generated successfully.',
      data: tokenData,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Step 4 & 5: App generates a deep link containing the token, sends back to server, server emails link to customer.
 */
export async function sendDeletionLinkHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const email = req.body?.email || req.user?.email;
    const deletionToken = req.body?.deletionToken;
    const deletionLink = req.body?.deletionLink;

    if (!email || !deletionToken || !deletionLink) {
      res.status(400).json({
        status: 'error',
        message: 'email, deletionToken, and deletionLink are required fields.',
      });
      return;
    }

    const result = await processSendDeletionLink(email, deletionToken, deletionLink);

    if (!result.success) {
      res.status(400).json({
        status: 'error',
        message: result.error || 'Failed to process deletion link.',
      });
      return;
    }

    res.status(200).json({
      status: 'success',
      message: 'Deletion confirmation link sent to customer email successfully.',
      data: {
        email: email.trim().toLowerCase(),
        sentAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Step 7 & 8: App sends confirmation (with deletionToken) after user clicks deep link in email. Backend deletes user data completely.
 */
export async function confirmDeletionHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const email = req.body?.email || (req.query?.email as string) || req.user?.email;
    const deletionToken = req.body?.deletionToken || (req.query?.deletionToken as string) || (req.query?.token as string);

    if (!deletionToken) {
      res.status(400).json({
        status: 'error',
        message: 'deletionToken is required to confirm account deletion.',
      });
      return;
    }

    const result = await confirmAndDeleteAccount(email, deletionToken);

    if (!result.success) {
      res.status(400).json({
        status: 'error',
        message: result.error || 'Failed to confirm account deletion.',
      });
      return;
    }

    res.status(200).json({
      status: 'success',
      message: 'Customer account and associated data have been permanently deleted.',
      data: {
        email: result.email,
        deletedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getFavoritesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const email = req.user?.email;
    if (!email) {
      res.status(401).json({ status: 'error', message: 'Unauthorized.' });
      return;
    }

    const userProfile = await upsertUserProfile({ email, username: req.user?.username });
    const itemType = req.query.itemType ? String(req.query.itemType) : undefined;

    const favorites = await getUserFavorites(userProfile.id, itemType);

    res.status(200).json({
      status: 'success',
      data: {
        total: favorites.length,
        favorites,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function addFavoriteHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const email = req.user?.email;
    if (!email) {
      res.status(401).json({ status: 'error', message: 'Unauthorized.' });
      return;
    }

    const { itemType, itemId, metadata } = req.body;
    if (!itemType || !itemId) {
      res.status(400).json({ status: 'error', message: 'itemType and itemId are required.' });
      return;
    }

    const userProfile = await upsertUserProfile({ email, username: req.user?.username });
    const favorite = await addFavorite(userProfile.id, { itemType, itemId, metadata });

    res.status(201).json({
      status: 'success',
      data: favorite,
    });
  } catch (error) {
    next(error);
  }
}

export async function removeFavoriteHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const email = req.user?.email;
    const favoriteId = req.params.id;

    if (!email || !favoriteId) {
      res.status(400).json({ status: 'error', message: 'Favorite ID is required.' });
      return;
    }

    const userProfile = await upsertUserProfile({ email, username: req.user?.username });
    await removeFavorite(userProfile.id, favoriteId);

    res.status(200).json({
      status: 'success',
      message: 'Favorite removed successfully.',
    });
  } catch (error) {
    next(error);
  }
}

