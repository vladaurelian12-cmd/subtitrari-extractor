FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.mjs ./server.mjs
USER node
ENV PORT=10000
EXPOSE 10000
CMD ["node", "server.mjs"]
