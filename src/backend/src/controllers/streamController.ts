import { Request, Response, NextFunction } from 'express';
import { getStreamConfig, getNowPlayingTrack } from '../services/streamService';

export async function getStreamConfigHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await getStreamConfig();
    res.status(200).json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getNowPlayingHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await getNowPlayingTrack();
    res.status(200).json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
}
