FROM node:20-bookworm-slim

WORKDIR /app
COPY package*.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/technician/package.json apps/technician/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --include=dev

COPY . .
ARG APP
ARG NEXT_PUBLIC_SUBIL_API_URL=http://127.0.0.1:3001
ENV NEXT_PUBLIC_SUBIL_API_URL=${NEXT_PUBLIC_SUBIL_API_URL}
RUN test "$APP" = api || npm run build --workspace "@subil/$APP"
ENV APP=${APP} NODE_ENV=production
CMD ["sh", "-c", "npm run start --workspace @subil/$APP -- -p $PORT"]
