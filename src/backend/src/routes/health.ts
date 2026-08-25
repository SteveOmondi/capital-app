import { Router } from 'express';
import { livenessHandler, readinessHandler } from '../controllers/healthController';

const router = Router();

router.get('/healthz', livenessHandler);
router.get('/readyz', readinessHandler);

export default router;
