# Dockerfile

# Stage 1: Build
FROM node:14 AS build

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Build the application (if needed)
RUN npm run build


# Stage 2: Production
FROM node:14 AS production

# Set the working directory
WORKDIR /app

# Copy only the built assets from the build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./

# Install only production dependencies
RUN npm install --only=production

# Expose the port the app runs on
EXPOSE 8080

# Command to run the application
CMD [ "node", "dist/server.js" ]
