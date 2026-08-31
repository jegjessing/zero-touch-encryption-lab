FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src

USER node
EXPOSE 8088
CMD ["node", "src/server.js"]
