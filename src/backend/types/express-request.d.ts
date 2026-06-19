export {};

interface AuthenticatedUserShape {
  oid: string;
  preferredUsername: string;
  name: string;
  roles: string[];
  tid: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUserShape;
      tenant?: unknown;
    }
  }
}
