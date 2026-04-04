FROM mcr.microsoft.com/devcontainers/javascript-node:24

RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap \
  && rm -rf /var/lib/apt/lists/*
