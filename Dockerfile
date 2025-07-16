# Use the Ollama base image
FROM python:3.11-slim

# Update system and install extra dependencies
RUN apt update && apt upgrade -y && \
    apt install -y --no-install-recommends \
        build-essential \
        libpq-dev \
    && apt clean && rm -rf /var/lib/apt/lists/*

# Environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Set working directory
WORKDIR /app

# Copy Python requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy all app code
COPY . .

ENTRYPOINT ["python3", "app.py"]

