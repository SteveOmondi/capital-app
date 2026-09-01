import { Router } from 'express';
import { getPodcastsHandler, getRssPodcastsHandler } from '../controllers/podcastController';

const router = Router();

router.get('/podcasts', getPodcastsHandler);
router.get('/podcasts/rss', getRssPodcastsHandler);

export default router;
