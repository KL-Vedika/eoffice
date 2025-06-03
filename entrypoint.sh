#!/bin/bash
set -e


echo "Starting vLLM OpenAI-compatible server in background..."
vllm serve  Qwen/Qwen2.5-VL-3B-Instruct-AWQ --port 8080 &

# Wait a few seconds to ensure the server has started
sleep 10

echo "Running app.py..."
python3 app.py
