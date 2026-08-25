import { Request, Response } from 'express';
import { getLivenessStatus, getReadinessStatus } from '../services/healthService';

export async function livenessHandler(_req: Request, res: Response): Promise<void> {
  const data = await getLivenessStatus();
  res.status(200).json(data);
}

export async function readinessHandler(_req: Request, res: Response): Promise<void> {
  const data = await getReadinessStatus();
  const statusCode = data.status === 'error' ? 503 : 200;
  res.status(statusCode).json(data);
}
