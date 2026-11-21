FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
# The Prisma seed script imports the shared role permissions from src.
COPY --from=build /app/src/common/constants/permissions.ts ./src/common/constants/permissions.ts
RUN mkdir -p uploads backups
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
