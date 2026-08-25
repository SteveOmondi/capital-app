import { Request, Response, NextFunction } from 'express';
import { getWeeklySchedules } from '../services/scheduleService';

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
