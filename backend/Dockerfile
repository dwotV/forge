FROM node:20-alpine

WORKDIR /app

# Instalar dependencias del sistema que necesita node-pty
RUN apk add --no-cache python3 make g++ linux-headers openssh-client sshpass

COPY package.json .
RUN npm install --production

COPY server.js .

EXPOSE 3000

CMD ["node", "server.js"]
