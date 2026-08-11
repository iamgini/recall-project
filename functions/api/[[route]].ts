import app from '../../src/index';

export const onRequest: PagesFunction<{ DB: D1Database }> = (context) => {
  return app.fetch(context.request, context.env, context);
};
