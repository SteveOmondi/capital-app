import { Request, Response, NextFunction } from 'express';
import { getArticles } from '../services/wordpressService';

export async function getNewsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const category = req.query.category ? String(req.query.category) : undefined;
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 10;
    const search = req.query.search ? String(req.query.search) : undefined;

    const data = await getArticles({ category, page, limit, search });

    res.status(200).json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
}
