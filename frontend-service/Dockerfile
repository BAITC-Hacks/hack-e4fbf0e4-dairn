FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS browser-dependencies
RUN npx playwright install --with-deps chromium

FROM dependencies AS source
ARG VITE_ASSISTANT_API_URL=http://localhost:8000
ARG VITE_CERTIFICATE_ORIGINS=
ENV VITE_ASSISTANT_API_URL=$VITE_ASSISTANT_API_URL
ENV VITE_CERTIFICATE_ORIGINS=$VITE_CERTIFICATE_ORIGINS
COPY index.html tsconfig.json vite.config.ts playwright.config.ts eslint.config.js .prettierrc.json .prettierignore ./
COPY src ./src
COPY test ./test
COPY e2e ./e2e
COPY README.md react-standards.md .gitignore docker-compose.yml ./

FROM source AS test
CMD ["npm", "run", "check"]

FROM browser-dependencies AS e2e
ARG VITE_ASSISTANT_API_URL=http://localhost:8000
ENV VITE_ASSISTANT_API_URL=$VITE_ASSISTANT_API_URL
COPY --from=source /app /app
RUN npm run build
CMD ["npm", "run", "test:e2e"]

FROM source AS preview
RUN npm run build
RUN mkdir -p node_modules/.vite-temp && chown -R node:node node_modules/.vite-temp
USER node
EXPOSE 4173
CMD ["npm", "run", "preview"]

FROM source AS production-build
RUN npm run build

FROM nginx:stable-alpine AS production
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=production-build /app/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
