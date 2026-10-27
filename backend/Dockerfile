FROM python:3.12-slim

ENV PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# LibreOffice do konwersji Word -> PDF (dokumenty) i Excel -> PDF (raporty) oraz czcionki zgodne z Calibri/Arial
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-writer-nogui libreoffice-calc-nogui fonts-crosextra-carlito fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install .

COPY . .

RUN useradd --create-home --uid 1000 apt && mkdir -p /app/data && chown -R apt:apt /app
USER apt

EXPOSE 8000

# Migracje przy starcie, potem serwer API
CMD ["sh", "-c", "alembic upgrade head && python -m app.cli encrypt-files && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
