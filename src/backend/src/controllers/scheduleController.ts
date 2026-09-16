import { Request, Response, NextFunction } from 'express';
import { getWeeklySchedules, getScheduleNow, getLiveState } from '../services/scheduleService';

export async function getSchedulesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const day = req.query.day ? String(req.query.day) : undefined;
    const data = await getWeeklySchedules(day);

    res.status(200).json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getScheduleNowHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await getScheduleNow();
    res.status(200).json({
      status: 'success',
      data: data.data,
      meta: data.meta,
    });
  } catch (error) {
    next(error);
  }
}

export async function getLiveStateHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await getLiveState();
    res.status(200).json({
      status: 'success',
      data: data.data,
      meta: data.meta,
    });
  } catch (error) {
    next(error);
  }
}

