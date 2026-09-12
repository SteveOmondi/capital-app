import { Router } from 'express';
import { getNewsHandler, getCategoriesHandler, getTrendingNewsHandler, getArticleDetailHandler } from '../controllers/newsController';

const router = Router();

router.get('/news/categories', getCategoriesHandler);
router.get('/news/trending', getTrendingNewsHandler);
router.get('/news/:idOrSlug', getArticleDetailHandler);
router.get('/news', getNewsHandler);

export default router;
