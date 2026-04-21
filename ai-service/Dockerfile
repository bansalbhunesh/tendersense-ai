FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr libgl1-mesa-glx libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Create a non-root user and own the uploads directory
RUN adduser --disabled-password --no-create-home appuser \
    && mkdir -p /app/data/uploads \
    && chown -R appuser:appuser /app
USER appuser
EXPOSE 8081
ENV PORT=8081
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8081"]
