import { Router } from 'express';
import {
  registerNotificationHandler,
  wordpressPostPublishedWebhookHandler,
  podcastEpisodePublishedWebhookHandler,
} from '../controllers/notificationController';

const router = Router();

// Device Token & Topic Registration
router.post('/notifications/register', registerNotificationHandler);

// Webhook Event Listeners
router.post('/webhooks/wordpress/post-published', wordpressPostPublishedWebhookHandler);
router.post('/webhooks/podcasts/episode-published', podcastEpisodePublishedWebhookHandler);

export default router;
