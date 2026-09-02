import { Router } from 'express';
import healthRoutes from './health';
import newsRoutes from './news';
import podcastRoutes from './podcasts';
import scheduleRoutes from './schedules';
import streamRoutes from './stream';
import notificationRoutes from './notifications';
import userRoutes from './user';
import swaggerRoutes from './swagger';

import searchRoutes from './search';

const router = Router();

// Interactive Swagger UI at /docs
router.use('/', swaggerRoutes);

// Health checks mounted at root level as well as under /api/v1
router.use('/', healthRoutes);
router.use('/api/v1', healthRoutes);

// Content & Audio Gateway Routes
router.use('/api/v1', newsRoutes);
router.use('/api/v1', podcastRoutes);
router.use('/api/v1', searchRoutes);
router.use('/api/v1', scheduleRoutes);
router.use('/api/v1', streamRoutes);

// Notifications & Webhooks
router.use('/api/v1', notificationRoutes);

// User Profile & Favorites Sync
router.use('/api/v1', userRoutes);

export default router;
