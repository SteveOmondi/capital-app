import { Router } from 'express';
import { getStreamConfigHandler, getNowPlayingHandler } from '../controllers/streamController';

const router = Router();

router.get('/stream/config', getStreamConfigHandler);
router.get('/stream/nowplaying', getNowPlayingHandler);

export default router;
