FROM node:22-slim

RUN mkdir -p /app && chown node:node /app
WORKDIR /app

USER node

COPY --chown=node:node package.json ./
RUN npm install

COPY --chown=node:node . .

EXPOSE 8788

CMD sh -c "\
  if [ -n \"$RECALL_API_KEY\" ]; then echo \"RECALL_API_KEY=$RECALL_API_KEY\" > .dev.vars; fi && \
  npx wrangler d1 execute recall-db --local --file=./schema.sql && \
  npx wrangler pages dev --ip 0.0.0.0 --port 8788"
