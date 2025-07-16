#!/bin/bash
set -e

echo "Starting Ollama server in background..."
ollama serve &

sleep 10

echo "Pulling model if not already present..."
ollama pull gemma3:27b

echo "Running app.py..."
python3 app.py

