FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY dist/ ./dist/

RUN mkdir -p /app/data

EXPOSE 3010

CMD ["node", "dist/index.js"]
