import { Request, Response, NextFunction } from 'express';
import { getAuthors, getAuthorByIdOrSlug, getAuthorArticles, AuthorListQuery } from '../services/authorService';

function parseIntParam(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
}

export async function getAuthorsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query: AuthorListQuery = {
      search: req.query.search ? String(req.query.search) : undefined,
      orderby: req.query.orderby ? (String(req.query.orderby) as AuthorListQuery['orderby']) : undefined,
      page: parseIntParam(req.query.page),
      per_page: parseIntParam(req.query.per_page ?? req.query.limit),
    };

    const result = await getAuthors(query);

    res.status(200).json({
      status: 'success',
      data: result.data,
      meta: result.meta,
    });
  } catch (error) {
    next(error);
  }
}

export async function getAuthorDetailHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { idOrSlug } = req.params;
    const author = await getAuthorByIdOrSlug(idOrSlug);

    if (!author) {
      res.status(404).json({
        status: 'fail',
        message: `Author '${idOrSlug}' not found`,
      });
      return;
    }

    res.status(200).json({
      status: 'success',
      data: author,
    });
  } catch (error) {
    next(error);
  }
}

export async function getAuthorArticlesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { idOrSlug } = req.params;
    const result = await getAuthorArticles(idOrSlug, {
      page: parseIntParam(req.query.page),
      per_page: parseIntParam(req.query.per_page ?? req.query.limit),
      fields: req.query.fields === 'full' ? 'full' : 'summary',
    });

    if (!result) {
      res.status(404).json({
        status: 'fail',
        message: `Author '${idOrSlug}' not found`,
      });
      return;
    }

    res.status(200).json({
      status: 'success',
      data: {
        author: result.author,
        articles: result.articles,
      },
      meta: result.meta,
    });
  } catch (error) {
    next(error);
  }
}
