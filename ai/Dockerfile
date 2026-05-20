FROM python:3.12-slim AS base

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --upgrade pip && \
    pip install --root-user-action=ignore -e .

COPY app ./app
COPY run.py ./run.py

EXPOSE 8000

# run.py installs the WindowsSelectorEventLoopPolicy on Windows; on Linux
# (in this container) the default loop is already psycopg-compatible, but
# the wrapper still works as a single entrypoint.
CMD ["python", "run.py", "--no-reload"]
