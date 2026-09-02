import { Router } from 'express';
import { globalSearchHandler } from '../controllers/searchController';

const router = Router();

router.get('/search', globalSearchHandler);

export default router;
