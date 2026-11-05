import { Router } from 'express';
import { getAuthorsHandler, getAuthorDetailHandler, getAuthorArticlesHandler } from '../controllers/authorController';

const router = Router();

router.get('/authors', getAuthorsHandler);
router.get('/authors/:idOrSlug/articles', getAuthorArticlesHandler);
router.get('/authors/:idOrSlug', getAuthorDetailHandler);

export default router;
