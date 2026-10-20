# syntax=docker/dockerfile:1
# Dark Star Rail talent API (FastAPI + sqlite). Everything operational is env-driven;
# see the "Backend deployment" section of the repo README for the full env contract.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py auth.py x402_server.py ./

# sqlite lives on a mounted volume at /data so deploys do not wipe the directory
RUN useradd --uid 10001 --create-home btai \
    && mkdir -p /data \
    && chown -R btai:btai /data
USER btai

ENV BTAI_DB_PATH=/data/talent.db \
    BTAI_HOST=0.0.0.0 \
    BTAI_PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT',os.environ.get('BTAI_PORT','8000'))+'/health',timeout=4)"

# $PORT is what Render/Railway/Fly inject; BTAI_PORT and 8000 are the fallbacks
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-${BTAI_PORT:-8000}}"]
