FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/smilecare.db
EXPOSE 3001
CMD ["npm", "run", "start", "-w", "smilecare-server"]
