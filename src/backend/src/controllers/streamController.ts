import { Request, Response, NextFunction } from 'express';
import { getStreamConfig, getNowPlayingTrack, proxyLiveAudioStream } from '../services/streamService';

export async function getStreamConfigHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const host = req.get('host') || req.headers.host;
    const protocol = req.protocol || 'https';
    const baseUrl = host ? `${protocol}://${host}` : undefined;
    const data = await getStreamConfig(baseUrl);
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
    const host = req.get('host') || req.headers.host;
    const protocol = req.protocol || 'https';
    const baseUrl = host ? `${protocol}://${host}` : undefined;
    const data = await getNowPlayingTrack(baseUrl);
    res.status(200).json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function streamProxyHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await proxyLiveAudioStream(req, res);
  } catch (error) {
    next(error);
  }
}

