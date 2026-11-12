import { Router } from 'express';
import { getVideosHandler, getVideoDetailHandler } from '../controllers/videoController';

const router = Router();

router.get('/videos', getVideosHandler);
router.get('/videos/:idOrSlug', getVideoDetailHandler);

export default router;
