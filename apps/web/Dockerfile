FROM node:24-bookworm-slim
WORKDIR /app
RUN npm install --global pnpm@10.33.0
COPY . .
RUN pnpm install --frozen-lockfile
ENV DATA_SOURCE=django NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
RUN pnpm --filter @all/web build
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@all/web", "start"]
