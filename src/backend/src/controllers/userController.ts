import { Request, Response, NextFunction } from 'express';
import { upsertUserProfile, getUserProfileByEmail } from '../services/userService';
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

    const profile = await getUserProfileByEmail(email);
    if (!profile) {
      res.status(404).json({ status: 'error', message: 'User profile not found.' });
      return;
    }

    res.status(200).json({
      status: 'success',
      data: profile,
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
