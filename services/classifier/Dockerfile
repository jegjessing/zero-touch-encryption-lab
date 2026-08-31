FROM node:24-alpine

# Small, reproducible image. Install deps first so the layer is cached across
# code changes.
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src

# Never run as root inside the container.
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
