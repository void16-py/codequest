# Minimal Dockerfile for CodeQuest (Node, zero dependencies)
FROM node:20-alpine

# App directory
WORKDIR /app

# Copy everything into the image
COPY . .

# Render provides PORT via env; the server already reads process.env.PORT
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
