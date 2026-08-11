FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs app.mjs /app/
ENV SITE_ROOT=/app/site \
    CONTENT_ROOT=/app/content \
    NODE_ENV=production
CMD ["node", "server.mjs"]
