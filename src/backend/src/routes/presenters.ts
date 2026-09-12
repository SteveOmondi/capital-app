import { Router } from 'express';
import { getPresentersHandler, getPresenterDetailHandler } from '../controllers/presenterController';

const router = Router();

router.get('/presenters', getPresentersHandler);
router.get('/presenters/:idOrSlug', getPresenterDetailHandler);

export default router;
