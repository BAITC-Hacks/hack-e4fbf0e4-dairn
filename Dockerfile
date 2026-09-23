FROM python:3.11-slim

WORKDIR /workspace
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir ".[test]"
COPY scripts/docker-entrypoint.sh /usr/local/bin/harness-entrypoint
RUN chmod +x /usr/local/bin/harness-entrypoint
ENTRYPOINT ["harness-entrypoint"]
CMD ["--help"]
