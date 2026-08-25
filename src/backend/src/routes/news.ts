import { Router } from 'express';
import { getNewsHandler } from '../controllers/newsController';

const router = Router();

router.get('/news', getNewsHandler);

export default router;
