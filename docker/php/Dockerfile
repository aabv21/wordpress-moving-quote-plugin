FROM php:8.3.36-cli-alpine@sha256:86a7a8f46bbf73120a19cf72246f606b6de9aaa84a00971c25d187fbae44c211

COPY --from=composer:2.11.0@sha256:278dfc7bd35169965d03f87194816f43bf4e6b6ea61707c2114e52ad12fe24ce /usr/bin/composer /usr/bin/composer

RUN apk add --no-cache git unzip

ENV COMPOSER_HOME=/tmp/composer

WORKDIR /app
