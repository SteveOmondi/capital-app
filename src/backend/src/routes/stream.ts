import { Router } from 'express';
import { getStreamConfigHandler, getNowPlayingHandler, streamProxyHandler } from '../controllers/streamController';

const router = Router();

router.get('/stream/config', getStreamConfigHandler);
router.get('/stream/nowplaying', getNowPlayingHandler);
router.get('/stream/listen', streamProxyHandler);

export default router;
