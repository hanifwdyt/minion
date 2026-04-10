FROM node:22-slim

# Install Claude CLI + basic tools
RUN apt-get update && apt-get install -y curl git sudo jq && \
    npm install -g @anthropic-ai/claude-code && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
COPY packages/server/package*.json ./packages/server/
COPY packages/web/package*.json ./packages/web/

# Install dependencies
RUN npm install

# Copy source
COPY . .

# Build
RUN npm run build

EXPOSE 3001

CMD ["npm", "start"]
