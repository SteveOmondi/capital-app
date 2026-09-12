import { Request, Response, NextFunction } from 'express';
import { getPresenters, getPresenterBySlug, PresenterQuery } from '../services/presenterService';

export async function getPresentersHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query: PresenterQuery = {
      search: req.query.search ? String(req.query.search) : undefined,
      fields: req.query.fields as any,
      page: req.query.page ? parseInt(String(req.query.page), 10) : 1,
      per_page: req.query.per_page ? parseInt(String(req.query.per_page), 10) : 20,
    };

    const result = await getPresenters(query);

    res.status(200).json({
      status: 'success',
      data: result.data,
      meta: result.meta,
    });
  } catch (error) {
    next(error);
  }
}

export async function getPresenterDetailHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { idOrSlug } = req.params;
    const presenter = await getPresenterBySlug(idOrSlug);

    if (!presenter) {
      res.status(404).json({
        status: 'fail',
        message: `Presenter '${idOrSlug}' not found`,
      });
      return;
    }

    res.status(200).json({
      status: 'success',
      data: presenter,
    });
  } catch (error) {
    next(error);
  }
}
