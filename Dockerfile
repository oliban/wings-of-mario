# The game is plain ES modules with no build step, but it is no longer only
# static files: the same process serves the assets and hosts the WebSocket
# rooms, so one origin covers both and there is no CORS or cross-origin
# WebSocket configuration anywhere. MIME types are explicit in
# server/static.js for the reason the nginx config gave: a module served as
# text/plain is refused by the browser and the whole game silently fails to
# boot.
FROM node:22-alpine

WORKDIR /app

# Dependencies first so a source-only change does not reinstall them.
# `--omit=dev` drops playwright, which is 400MB of browser nobody needs in
# production.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Only what the server actually serves. tests/, tools/ and shots/ are excluded
# by .dockerignore as well, but naming the copies keeps the image honest about
# its contents.
COPY server ./server
COPY src ./src
COPY index.html pilot.html ./
# The social preview image, kept from upstream's nginx image for the reason
# their comment gave: a missing asset is not necessarily a 404. Under nginx's
# `try_files ... /index.html` it came back 200 with text/html, so a shared link
# had no preview and nothing looked broken until you checked the content type.
COPY og.png ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "server/index.js"]
