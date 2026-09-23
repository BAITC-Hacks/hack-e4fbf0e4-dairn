FROM gradle:8.8-jdk21 AS build
WORKDIR /workspace
COPY gradlew settings.gradle.kts build.gradle.kts ./
COPY gradle gradle
COPY src src
RUN sh ./gradlew --no-daemon test serverDist

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --create-home --shell /usr/sbin/nologin catalog
COPY --from=build --chown=catalog:catalog /workspace/build/server/ /app/
USER catalog
ENV CATALOG_HOST=0.0.0.0 PORT=8080 CATALOG_SOURCE=live
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/ekt-service-catalog.jar"]
