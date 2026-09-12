import { Request, Response, NextFunction } from 'express';
import { getEvents, getEventBySlug, EventQuery } from '../services/eventService';

export async function getEventsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query: EventQuery = {
      status: req.query.status as any,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      city: req.query.city ? String(req.query.city) : undefined,
      venue: req.query.venue ? String(req.query.venue) : undefined,
      category: req.query.category ? String(req.query.category) : undefined,
      tag: req.query.tag ? String(req.query.tag) : undefined,
      featured: req.query.featured !== undefined ? req.query.featured === 'true' : undefined,
      free: req.query.free !== undefined ? req.query.free === 'true' : undefined,
      orderby: req.query.orderby as any,
      order: req.query.order as any,
      fields: req.query.fields as any,
      page: req.query.page ? parseInt(String(req.query.page), 10) : 1,
      per_page: req.query.per_page ? parseInt(String(req.query.per_page), 10) : 20,
    };

    const result = await getEvents(query);

    res.status(200).json({
      status: 'success',
      data: result.data,
      meta: result.meta,
    });
  } catch (error) {
    next(error);
  }
}

export async function getEventDetailHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { idOrSlug } = req.params;
    const event = await getEventBySlug(idOrSlug);

    if (!event) {
      res.status(404).json({
        status: 'fail',
        message: `Event '${idOrSlug}' not found`,
      });
      return;
    }

    res.status(200).json({
      status: 'success',
      data: event,
    });
  } catch (error) {
    next(error);
  }
}
