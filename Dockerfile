# Use a more modern Node.js version (optional but recommended)
FROM node:18-slim

# Set the working directory
WORKDIR /app

# Copy package configuration
COPY package*.json ./

# Install production dependencies
RUN npm install --only=production

# Copy the rest of your application code
COPY . .

# Cloud Run expects the app to listen on the PORT environment variable (default 8080)
EXPOSE 8080

# Command to run your application using ES modules
CMD [ "node", "server.mjs" ]
