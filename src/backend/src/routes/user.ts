import { Router } from 'express';
import { authenticateUser, requireAuth } from '../middlewares/auth';
import {
  upsertProfileHandler,
  getProfileHandler,
  getFavoritesHandler,
  addFavoriteHandler,
  removeFavoriteHandler,
} from '../controllers/userController';

const router = Router();

// Apply user authentication middleware
router.use(authenticateUser);

// Profile endpoints
router.post('/user/profile', upsertProfileHandler);
router.get('/user/profile', requireAuth, getProfileHandler);

// Favorites endpoints (Protected)
router.get('/user/favorites', requireAuth, getFavoritesHandler);
router.post('/user/favorites', requireAuth, addFavoriteHandler);
router.delete('/user/favorites/:id', requireAuth, removeFavoriteHandler);

export default router;
