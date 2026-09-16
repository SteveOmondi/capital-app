import { Router } from 'express';
import { getSchedulesHandler, getScheduleNowHandler, getLiveStateHandler } from '../controllers/scheduleController';

const router = Router();

router.get('/live', getLiveStateHandler);
router.get('/schedules/live', getLiveStateHandler);
router.get('/schedules/now', getScheduleNowHandler);
router.get('/schedules', getSchedulesHandler);

export default router;
