import { Router } from 'express';
import {
  getPodcastsHandler,
  getPodcastGroupsHandler,
  getPodcastEpisodesHandler,
  getRssPodcastsHandler,
} from '../controllers/podcastController';

const router = Router();

router.get('/podcasts', getPodcastsHandler);
router.get('/podcasts/groups', getPodcastGroupsHandler);
router.get('/podcasts/episodes', getPodcastEpisodesHandler);
router.get('/podcasts/rss', getRssPodcastsHandler);

export default router;
