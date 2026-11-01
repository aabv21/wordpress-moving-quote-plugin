FROM php:8.5.12-cli-alpine

COPY --from=composer:2.11.0 /usr/bin/composer /usr/bin/composer

RUN apk add --no-cache git unzip

ENV COMPOSER_HOME=/tmp/composer

WORKDIR /app
