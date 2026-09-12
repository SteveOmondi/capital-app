import { Router } from 'express';
import { getEventsHandler, getEventDetailHandler } from '../controllers/eventController';

const router = Router();

router.get('/events', getEventsHandler);
router.get('/events/:idOrSlug', getEventDetailHandler);

export default router;
