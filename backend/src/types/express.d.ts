declare global {
  namespace Express {
    interface Request {
      /**
       * Dados ja validados pelo middleware `validate`. Nao escrevemos em req.query
       * porque no Express 5 ele e um getter (nao pode ser reatribuido).
       */
      valid?: Record<string, unknown>;
    }
  }
}

export {};
