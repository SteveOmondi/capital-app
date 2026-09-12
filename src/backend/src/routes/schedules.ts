import { Router } from 'express';
import { getSchedulesHandler, getScheduleNowHandler } from '../controllers/scheduleController';

const router = Router();

router.get('/schedules/now', getScheduleNowHandler);
router.get('/schedules', getSchedulesHandler);

export default router;
