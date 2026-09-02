import { Request, Response, NextFunction } from 'express';
import { performGlobalSearch } from '../services/searchService';

export async function globalSearchHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawQuery = req.query.q || req.query.query || req.query.search;
    const query = rawQuery ? String(rawQuery).trim() : '';

    if (!query) {
      res.status(400).json({
        status: 'fail',
        message: 'Search query string (q, query, or search) is required',
      });
      return;
    }

    const category = req.query.category ? String(req.query.category) : undefined;
    const type = req.query.type ? String(req.query.type) : undefined;
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 10;

    const data = await performGlobalSearch({
      query,
      category,
      type,
      page,
      limit,
    });

    res.status(200).json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
}
