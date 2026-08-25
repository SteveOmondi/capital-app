/* eslint-disable @typescript-eslint/no-unused-vars */
import { Request } from 'express';

export interface UserContext {
  id?: string;
  email: string;
  username?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: UserContext;
    }
  }
}
