import { Request, Response, NextFunction } from 'express';
import { getArticles, getNewsCategories, getTrendingArticles, getArticleBySlug } from '../services/wordpressService';

export async function getNewsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const category = req.query.category ? String(req.query.category) : undefined;
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 10;
    const search = req.query.search ? String(req.query.search) : undefined;
    const author = req.query.author ? String(req.query.author) : undefined;
    const tag = req.query.tag ? String(req.query.tag) : undefined;

    const data = await getArticles({ category, page, limit, search, author, tag });

    res.status(200).json({
      status: 'success',
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getAuthorHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { idOrSlug } = req.params;
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 10;

    const data = await getArticles({ author: idOrSlug, page, limit });

    if (data.articles.length === 0) {
      res.status(404).json({
        status: 'fail',
        message: `Author '${idOrSlug}' not found or has no published articles`,
      });
      return;
    }

    const firstArticle = data.articles[0];
    const authorProfile = firstArticle.authorDetails || {
      name: firstArticle.author || idOrSlug,
      slug: idOrSlug,
    };

    res.status(200).json({
      status: 'success',
      data: {
        author: authorProfile,
        articles: data.articles,
        total: data.total,
        page: data.page,
        limit: data.limit,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getCategoriesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const categories = await getNewsCategories();
    res.status(200).json({
      status: 'success',
      data: {
        total: categories.length,
        categories,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getTrendingNewsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const days = req.query.days ? parseInt(String(req.query.days), 10) : 7;
    const category = req.query.category ? String(req.query.category) : undefined;

    const articles = await getTrendingArticles(days, category);
    res.status(200).json({
      status: 'success',
      data: {
        total: articles.length,
        articles,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getArticleDetailHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { idOrSlug } = req.params;
    const article = await getArticleBySlug(idOrSlug);

    if (!article) {
      res.status(404).json({
        status: 'fail',
        message: `Article '${idOrSlug}' not found`,
      });
      return;
    }

    res.status(200).json({
      status: 'success',
      data: article,
    });
  } catch (error) {
    next(error);
  }
}

