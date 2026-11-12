import { Request, Response, NextFunction } from 'express';
import { getVideos, getVideoByIdOrSlug } from '../services/videoService';
import { withVideoFields } from '../services/wordpressService';

function parseIntParam(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
}

/** `true`/`1` = Shorts only, `false`/`0` = no Shorts; anything else means both. */
function parseShorts(value: unknown): boolean | undefined {
  const v = String(value ?? '').toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
}

export async function getVideosHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await getVideos({
      section: req.query.section ? String(req.query.section) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      shorts: parseShorts(req.query.shorts),
      fields: req.query.fields === 'full' ? 'full' : 'summary',
      page: parseIntParam(req.query.page),
      limit: parseIntParam(req.query.limit ?? req.query.per_page),
    });

    res.status(200).json({
      status: 'success',
      data: { ...data, articles: data.articles.map(withVideoFields) },
    });
  } catch (error) {
    next(error);
  }
}

export async function getVideoDetailHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { idOrSlug } = req.params;
    const article = await getVideoByIdOrSlug(idOrSlug);

    if (!article) {
      res.status(404).json({
        status: 'fail',
        message: `Video '${idOrSlug}' not found`,
      });
      return;
    }

    res.status(200).json({
      status: 'success',
      data: withVideoFields(article),
    });
  } catch (error) {
    next(error);
  }
}
