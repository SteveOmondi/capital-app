import { Router } from 'express';
import { getSchedulesHandler } from '../controllers/scheduleController';

const router = Router();

router.get('/schedules', getSchedulesHandler);

export default router;
