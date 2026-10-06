import { Router } from 'express';
import { authenticateUser, requireAuth } from '../middlewares/auth';
import {
  upsertProfileHandler,
  getProfileHandler,
  deleteProfileHandler,
  requestDeletionHandler,
  sendDeletionLinkHandler,
  confirmDeletionHandler,
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
router.delete('/user/profile', requireAuth, deleteProfileHandler);
router.delete('/user/account', requireAuth, deleteProfileHandler);

// Multi-step Profile Deletion Journey Endpoints
router.post('/user/delete-request', requestDeletionHandler);
router.post('/user/request-deletion', requestDeletionHandler);
router.post('/user/send-deletion-link', sendDeletionLinkHandler);
router.post('/user/confirm-deletion', confirmDeletionHandler);
router.delete('/user/confirm-deletion', confirmDeletionHandler);

// Favorites endpoints (Protected)
router.get('/user/favorites', requireAuth, getFavoritesHandler);
router.post('/user/favorites', requireAuth, addFavoriteHandler);
router.delete('/user/favorites/:id', requireAuth, removeFavoriteHandler);

export default router;

