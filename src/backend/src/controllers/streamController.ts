import { Request, Response, NextFunction } from 'express';
import { getStreamConfig, getNowPlayingTrack, proxyLiveAudioStream } from '../services/streamService';

function getRequestBaseUrl(req: Request): string | undefined {
  const host = req.get('host') || req.headers.host;
  if (!host) return undefined;

  const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = isLocal
    ? req.protocol || 'http'
    : typeof forwardedProto === 'string'
      ? forwardedProto.split(',')[0].trim()
      : 'https';

  return `${protocol}://${host}`;
}

export async function getStreamConfigHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const baseUrl = getRequestBaseUrl(req);
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
    const baseUrl = getRequestBaseUrl(req);
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

