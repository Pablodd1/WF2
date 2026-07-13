FROM node:22-slim
WORKDIR /app
COPY api/_lib/normalization-v4.cjs api/_lib/normalization-v4.cjs
COPY tools/shadow-reprocess/shadow-reprocess.cjs tools/shadow-reprocess/shadow-reprocess.cjs
CMD ["node", "tools/shadow-reprocess/shadow-reprocess.cjs"]

