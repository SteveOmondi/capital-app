import { Router } from 'express';
import { getPodcastsHandler } from '../controllers/podcastController';

const router = Router();

router.get('/podcasts', getPodcastsHandler);

export default router;
