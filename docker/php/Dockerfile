FROM php:8.3.36-cli-alpine@sha256:e7699f91d3b46283a49bde02379266dd98d87844e08aed1ff7ea6a7d1f031268

COPY --from=composer:2.11.0@sha256:278dfc7bd35169965d03f87194816f43bf4e6b6ea61707c2114e52ad12fe24ce /usr/bin/composer /usr/bin/composer

RUN apk add --no-cache git unzip

ENV COMPOSER_HOME=/tmp/composer

WORKDIR /app
