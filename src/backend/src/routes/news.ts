import { Router } from 'express';
import { getNewsHandler, getCategoriesHandler } from '../controllers/newsController';

const router = Router();

router.get('/news/categories', getCategoriesHandler);
router.get('/news', getNewsHandler);

export default router;
