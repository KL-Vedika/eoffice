FROM vllm/vllm-openai:latest

RUN apt update && apt upgrade -y

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Copy app codes.txt .
COPY . .

# Set the entrypoint to the entrypoint.sh script
RUN chmod +x entrypoint.sh
ENTRYPOINT [ "./entrypoint.sh" ]